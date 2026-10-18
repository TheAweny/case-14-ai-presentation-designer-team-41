import { randomUUID } from 'node:crypto';
import {
  PIPELINE_ROLES,
  SERVER_CONNECTION_ID,
  baseUrlProblem,
  VK_AI_SPACE_MODEL,
  VK_AI_SPACE_ROLES,
  headerRecord,
  headersProblem,
  normalizeHeaders,
  parseHeaderEnv,
  connectionModelsInputSchema,
  connectionInputProblems,
  connectionInputSchema,
  hasProblems,
  isModelEnabled,
  isRoleOptional,
  usesWriterModelByDefault,
  keyHint,
  normalizeBaseUrl,
  probeInputSchema,
  roleAssignmentSchema,
  type ConnectionCheck,
  type ConnectionHeader,
  type ConnectionProblems,
  type ModelConnection,
  type ModelRef,
  type ModelSettings,
  type PipelineRole,
  type RoleAssignment,
} from '@lct/contracts';
import { checkModelConnection, isPrivateHost, type CheckOptions } from './connection-check.js';
import { KeyDecryptionError, type KeyVault } from './key-vault.js';
import type { ModelSettingsStore, StoredConnection, StoredRole } from './model-settings-store.js';

/**
 * Who asks. An administrator shares connections with everyone and sets the roles everyone starts
 * with; everyone else adds connections of their own and picks roles for themselves.
 */
export interface SettingsActor {
  readonly userId: string;
  readonly admin: boolean;
}

/** No such connection: removed in another tab, or a wrong id. */
export class ModelConnectionNotFoundError extends Error {
  override readonly name = 'ModelConnectionNotFoundError';
  constructor(readonly connectionId: string) {
    super(`Model connection not found: ${connectionId}`);
  }
}

/** The input did not pass; `problems` per form field when they are the cause. */
export class InvalidModelSettingsInputError extends Error {
  override readonly name = 'InvalidModelSettingsInputError';
  constructor(readonly problems: ConnectionProblems = {}) {
    super('Invalid model settings');
  }
}

/**
 * The connection cannot be changed by whoever asks: it comes from the server environment, or an
 * administrator shared it.
 */
export class ManagedConnectionError extends Error {
  override readonly name = 'ManagedConnectionError';
  constructor(
    message = 'The server connection is configured in .env and cannot be changed from the interface.',
  ) {
    super(message);
  }
}

/** No model can write the deck. The message is for the person and names what to do. */
export class ModelNotConfiguredError extends Error {
  override readonly name = 'ModelNotConfiguredError';
}

/** Everything a provider needs to call a model. Lives only for the run that asked for it. */
export interface ResolvedModel {
  readonly connectionId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Headers the connection sends besides the key. */
  readonly headers: Readonly<Record<string, string>>;
}

/** Roles the server connection performs until someone assigns another model. */
const SERVER_DEFAULT_ROLES: readonly PipelineRole[] = ['writer'];

type Env = Readonly<Record<string, string | undefined>>;

export interface ModelSettingsServiceOptions extends CheckOptions {
  readonly env?: Env;
  readonly newId?: () => string;
}

/**
 * Model settings as the API keeps them. The server connection is built from `LLM_BASE_URL`,
 * `LLM_MODEL` and `MODEL_API_KEY`; connections added in the interface are stored with the key
 * encrypted. Nothing a method returns carries a key, apart from `resolve`, whose result goes
 * straight into the provider of a run and never into a response.
 */
export class ModelSettingsService {
  private readonly env: Env;
  private readonly newId: () => string;
  private readonly checkOptions: CheckOptions;
  /** The last check of the server connection. It has no row, so it lives as long as the process. */
  private serverCheck: ConnectionCheck | null = null;

  constructor(
    private readonly store: ModelSettingsStore,
    private readonly vault: KeyVault,
    options: ModelSettingsServiceOptions = {},
  ) {
    const { env = process.env, newId = randomUUID, ...checkOptions } = options;
    this.env = env;
    this.newId = newId;
    this.checkOptions = checkOptions;
  }

  /** The connection configured in the environment, or null when the server has none. */
  private server(): {
    baseUrl: string;
    model: string;
    apiKey: string;
    headers: ConnectionHeader[];
  } | null {
    const baseUrl = this.env.LLM_BASE_URL?.trim() ?? '';
    const model = this.env.LLM_MODEL?.trim() ?? '';
    if (!baseUrl || !model || baseUrlProblem(baseUrl)) return null;
    // `MODEL_HEADERS` that do not read as headers are not sent: the check of the connection then
    // shows what the server answers without them.
    const headers = parseHeaderEnv(this.env.MODEL_HEADERS);
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
      apiKey: this.env.MODEL_API_KEY?.trim() ?? '',
      headers: headersProblem(headers) ? [] : normalizeHeaders(headers),
    };
  }

  /**
   * The vision model of the server connection: `VLM_MODEL` when `VLM_BASE_URL` is the same
   * server as `LLM_BASE_URL`, as with a model that reads text and images alike. A vision model on
   * another server is not a connection of its own, so the role then waits for one.
   */
  private serverVisionModel(): string | undefined {
    const server = this.server();
    const visionUrl = this.env.VLM_BASE_URL?.trim() ?? '';
    const model = this.env.VLM_MODEL?.trim() ?? '';
    if (!server || !model || !visionUrl || baseUrlProblem(visionUrl)) return undefined;
    return normalizeBaseUrl(visionUrl) === server.baseUrl ? model : undefined;
  }

  /**
   * The server connection as everyone sees it. Which of its models are offered is stored by its
   * address, so the limit outlives the process and follows the gateway, not the name.
   */
  private async serverView(): Promise<ModelConnection | null> {
    const server = this.server();
    if (!server) return null;
    const enabledModels = await this.store.getServerModels(server.baseUrl);
    return {
      connectionId: SERVER_CONNECTION_ID,
      name: new URL(server.baseUrl).hostname,
      preset: 'custom',
      baseUrl: server.baseUrl,
      hasKey: server.apiKey !== '',
      keyHint: keyHint(server.apiKey || null),
      headers: server.headers,
      lastCheck: this.serverCheck ?? (await this.store.getServerCheck(server.baseUrl)),
      enabledModels: enabledModels === null ? null : [...enabledModels],
      managed: true,
    };
  }

  /** The key of a stored connection, or null when none is set or it no longer decrypts. */
  private keyOf(stored: StoredConnection): string | null {
    if (stored.apiKeyEncrypted === null || !this.vault.available) return null;
    try {
      return this.vault.decrypt(stored.apiKeyEncrypted, stored.connectionId);
    } catch (error) {
      if (error instanceof KeyDecryptionError) return null;
      throw error;
    }
  }

  private static visible(stored: StoredConnection, actor: SettingsActor): boolean {
    return stored.ownerId === null || stored.ownerId === actor.userId;
  }

  private static editable(stored: StoredConnection, actor: SettingsActor): boolean {
    return stored.ownerId === actor.userId || (stored.ownerId === null && actor.admin);
  }

  private publicView(stored: StoredConnection, actor: SettingsActor): ModelConnection {
    // A key that no longer decrypts shows as missing: the person enters it again.
    const key = this.keyOf(stored);
    const editable = ModelSettingsService.editable(stored, actor);
    return {
      connectionId: stored.connectionId,
      name: stored.name,
      preset: stored.preset,
      baseUrl: stored.baseUrl,
      hasKey: key !== null,
      // Someone else's key is not even hinted at.
      keyHint: editable ? keyHint(key) : null,
      headers: [...stored.headers],
      lastCheck: stored.lastCheck,
      enabledModels: stored.enabledModels === null ? null : [...stored.enabledModels],
      managed: false,
      shared: stored.ownerId === null,
      editable,
    };
  }

  /**
   * A stored connection the actor may see; `edit` — may also change. Another account's
   * connection is answered as missing, a shared one the actor may not change as managed.
   */
  private async find(
    connectionId: string,
    actor: SettingsActor,
    edit = false,
  ): Promise<StoredConnection> {
    if (connectionId === SERVER_CONNECTION_ID) throw new ManagedConnectionError();
    const stored = await this.store.getConnection(connectionId);
    if (!stored || !ModelSettingsService.visible(stored, actor)) {
      throw new ModelConnectionNotFoundError(connectionId);
    }
    if (edit && !ModelSettingsService.editable(stored, actor)) {
      throw new ManagedConnectionError('Only an administrator can change a shared connection.');
    }
    return stored;
  }

  private allowPrivateHosts(): boolean {
    return this.checkOptions.allowPrivateHosts ?? false;
  }

  /**
   * Settings as the actor sees them: the server connection, shared connections and their own.
   * A role takes the actor's own choice, else the default an administrator set for everyone,
   * else the server connection. An administrator's choices are those defaults.
   */
  async get(actor: SettingsActor): Promise<ModelSettings> {
    const server = await this.serverView();
    const stored = await this.store.listConnections(actor.userId);
    const connections = [
      ...(server ? [server] : []),
      ...stored.map((c) => this.publicView(c, actor)),
    ];
    const ids = new Set(connections.map((connection) => connection.connectionId));
    const byRole = (list: readonly StoredRole[]) => new Map(list.map((role) => [role.role, role]));
    const defaults = byRole(await this.store.listRoles(null));
    // An administrator's own choices exist too: a model on a connection only they can use.
    const own = byRole(await this.store.listRoles(actor.userId));
    const usable = (assigned: StoredRole | undefined): assigned is StoredRole =>
      assigned !== undefined && (assigned.kind !== 'model' || ids.has(assigned.connectionId));
    const inherited: PipelineRole[] = [];
    const roles = PIPELINE_ROLES.map((role): RoleAssignment => {
      const mine = own.get(role);
      if (usable(mine)) return mine;
      const shared = defaults.get(role);
      if (usable(shared)) {
        if (!actor.admin) inherited.push(role);
        return shared;
      }
      // The model from .env is the fallback only while an administrator has not switched it off.
      const model =
        role === 'vision'
          ? this.serverVisionModel()
          : SERVER_DEFAULT_ROLES.includes(role)
            ? this.server()?.model
            : undefined;
      if (model && isModelEnabled(model, server?.enabledModels ?? null)) {
        inherited.push(role);
        return { role, kind: 'model', connectionId: SERVER_CONNECTION_ID, modelId: model };
      }
      return { role, kind: 'unassigned' };
    });
    return { connections, roles, inheritedRoles: inherited, managesShared: actor.admin };
  }

  async saveConnection(raw: unknown, actor: SettingsActor): Promise<ModelConnection> {
    const parsed = connectionInputSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const input = parsed.data;
    const problems = connectionInputProblems(input);
    if (hasProblems(problems)) throw new InvalidModelSettingsInputError(problems);

    const previous =
      input.connectionId === undefined ? null : await this.find(input.connectionId, actor, true);
    // Sharing is an administrator's: anyone else's connection is their own, whatever they ask.
    const ownerId =
      actor.admin && input.shared !== undefined
        ? input.shared
          ? null
          : actor.userId
        : (previous?.ownerId ?? (actor.admin ? null : actor.userId));
    const connectionId = previous?.connectionId ?? this.newId();
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const entered = input.apiKey?.trim() || null;
    const previousKey = previous ? this.keyOf(previous) : null;
    // An empty field keeps the stored key; a key that no longer decrypts is dropped with it.
    const apiKeyEncrypted =
      entered !== null
        ? this.vault.encrypt(entered, connectionId)
        : previousKey !== null
          ? (previous?.apiKeyEncrypted ?? null)
          : null;
    const keyChanged = entered !== null && entered !== previousKey;
    const headers =
      input.headers !== undefined
        ? normalizeHeaders(input.headers)
        : [...(previous?.headers ?? [])];
    const headersChanged = JSON.stringify(headers) !== JSON.stringify(previous?.headers ?? []);
    // The old check speaks of the old address, key and headers: after any changes it is no
    // longer true.
    const unchanged =
      previous !== null && previous.baseUrl === baseUrl && !keyChanged && !headersChanged;
    const lastCheck = input.lastCheck ?? (unchanged ? previous.lastCheck : null);

    const stored: StoredConnection = {
      connectionId,
      name: input.name.trim(),
      preset: input.preset,
      baseUrl,
      apiKeyEncrypted,
      lastCheck,
      ownerId,
      enabledModels: previous?.enabledModels ?? null,
      headers,
    };
    await this.store.saveConnection(stored);
    // A new VK AI Space connection is the model of the finals: a key and a project are all the
    // person enters, and its model takes the roles it can perform at once. Shared, it becomes the
    // default for everyone; someone else's own choices stay theirs.
    const roleOwner = ownerId === null ? null : actor.userId;
    if (previous === null && input.preset === 'vk-ai-space') {
      for (const role of VK_AI_SPACE_ROLES) {
        await this.store.setRole(
          { role, kind: 'model', connectionId, modelId: VK_AI_SPACE_MODEL },
          roleOwner,
        );
      }
    }
    await this.store.record({
      userId: actor.userId,
      action: previous ? 'connection-updated' : 'connection-created',
      connectionId,
      detail: {
        keyChanged,
        baseUrlChanged: previous !== null && previous.baseUrl !== baseUrl,
        shared: ownerId === null,
      },
    });
    return this.publicView(stored, actor);
  }

  /**
   * Limit which models of one connection stay available. Null lifts the limit, an empty list
   * switches every model off. The limit belongs to the connection, so for a shared one it applies
   * to every account; the server connection keeps it by its address.
   */
  async setConnectionModels(raw: unknown, actor: SettingsActor): Promise<ModelConnection> {
    const parsed = connectionModelsInputSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const { connectionId } = parsed.data;
    const enabledModels =
      parsed.data.enabledModels === null
        ? null
        : parsed.data.enabledModels.filter((modelId, at, all) => all.indexOf(modelId) === at);
    if (connectionId === SERVER_CONNECTION_ID) {
      const server = this.server();
      if (!server) throw new ModelConnectionNotFoundError(connectionId);
      // The address and key stay in .env. Which of its models are offered is an administrator's
      // choice, the same as a shared connection: everyone else only sees the shorter list.
      if (!actor.admin) {
        throw new ManagedConnectionError('Only an administrator can change a shared connection.');
      }
      await this.store.setServerModels(server.baseUrl, enabledModels);
      await this.store.record({
        userId: actor.userId,
        action: 'models-enabled',
        connectionId,
        detail: { enabled: enabledModels === null ? 'all' : enabledModels.length },
      });
      const view = await this.serverView();
      if (!view) throw new ModelConnectionNotFoundError(connectionId);
      return view;
    }
    const stored = await this.find(connectionId, actor, true);
    const saved = { ...stored, enabledModels };
    await this.store.saveConnection(saved);
    await this.store.record({
      userId: actor.userId,
      action: 'models-enabled',
      connectionId,
      detail: { enabled: enabledModels === null ? 'all' : enabledModels.length },
    });
    return this.publicView(saved, actor);
  }

  async deleteConnection(connectionId: string, actor: SettingsActor): Promise<void> {
    await this.find(connectionId, actor, true);
    if (!(await this.store.deleteConnection(connectionId))) {
      throw new ModelConnectionNotFoundError(connectionId);
    }
    await this.store.record({ userId: actor.userId, action: 'connection-deleted', connectionId });
  }

  async checkConnection(connectionId: string, actor: SettingsActor): Promise<ModelConnection> {
    if (connectionId === SERVER_CONNECTION_ID) {
      const server = this.server();
      if (!server) throw new ModelConnectionNotFoundError(connectionId);
      // The server connection is set by whoever runs the product, so its address is trusted.
      this.serverCheck = await checkModelConnection(
        {
          baseUrl: server.baseUrl,
          apiKey: server.apiKey || null,
          headers: headerRecord(server.headers),
        },
        { ...this.checkOptions, allowPrivateHosts: true },
      );
      // Kept by address, so a restart of the API still knows the models and their description.
      await this.store.setServerCheck(server.baseUrl, this.serverCheck);
      const view = await this.serverView();
      if (!view) throw new ModelConnectionNotFoundError(connectionId);
      return view;
    }
    const stored = await this.find(connectionId, actor);
    const lastCheck = await checkModelConnection(
      {
        baseUrl: stored.baseUrl,
        apiKey: this.keyOf(stored),
        headers: headerRecord(stored.headers),
      },
      this.checkOptions,
    );
    // The connection may have been edited or removed meanwhile: the outcome belongs to the same one.
    const current = await this.store.getConnection(connectionId);
    if (!current) throw new ModelConnectionNotFoundError(connectionId);
    if (
      current.baseUrl !== stored.baseUrl ||
      current.apiKeyEncrypted !== stored.apiKeyEncrypted ||
      JSON.stringify(current.headers) !== JSON.stringify(stored.headers)
    ) {
      return this.publicView(current, actor);
    }
    const checked = { ...current, lastCheck };
    await this.store.saveConnection(checked);
    return this.publicView(checked, actor);
  }

  async probe(raw: unknown, actor: SettingsActor): Promise<ConnectionCheck> {
    const parsed = probeInputSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const input = parsed.data;
    const problem = baseUrlProblem(input.baseUrl);
    if (problem) throw new InvalidModelSettingsInputError({ baseUrl: problem });
    const saved =
      input.connectionId === undefined ? null : await this.find(input.connectionId, actor, true);
    const apiKey = input.apiKey?.trim() || (saved ? this.keyOf(saved) : null);
    const headers = input.headers ?? saved?.headers ?? [];
    const headerIssue = headersProblem(headers);
    if (headerIssue) throw new InvalidModelSettingsInputError({ headers: headerIssue });
    return checkModelConnection(
      {
        baseUrl: normalizeBaseUrl(input.baseUrl),
        apiKey,
        headers: headerRecord(normalizeHeaders(headers)),
      },
      this.checkOptions,
    );
  }

  /**
   * Assign a role for the actor. An administrator assigns the default for everyone, so only
   * with a connection everyone can use: a shared one or the server's.
   */
  async setRole(raw: unknown, actor: SettingsActor): Promise<void> {
    const parsed = roleAssignmentSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const assignment = parsed.data;
    if (assignment.kind === 'default' && !usesWriterModelByDefault(assignment.role)) {
      throw new InvalidModelSettingsInputError();
    }
    if (assignment.kind === 'disabled' && !isRoleOptional(assignment.role)) {
      throw new InvalidModelSettingsInputError();
    }
    // An administrator's choice is the default for everyone, unless it is a model on a connection
    // only the administrator can use: that is their own choice, as anyone else's would be.
    let personal = !actor.admin;
    if (assignment.kind === 'model') {
      if (assignment.connectionId === SERVER_CONNECTION_ID) {
        if (this.server() === null) throw new ModelConnectionNotFoundError(assignment.connectionId);
      } else {
        const stored = await this.find(assignment.connectionId, actor);
        if (stored.ownerId !== null) personal = true;
      }
    }
    const owner = personal ? actor.userId : null;
    if (assignment.kind === 'unassigned') await this.store.clearRole(assignment.role, owner);
    else await this.store.setRole(assignment satisfies StoredRole, owner);
    // A default the administrator sets replaces their own earlier choice for the role.
    if (actor.admin && !personal) await this.store.clearRole(assignment.role, actor.userId);
    await this.store.record({
      userId: actor.userId,
      action: 'role-set',
      connectionId: assignment.kind === 'model' ? assignment.connectionId : null,
      detail: { role: assignment.role, kind: assignment.kind },
    });
  }

  /**
   * The model a run should write with: the one picked in the interface, else the model of the
   * writer role, else the server connection. The result holds the key and must go nowhere but
   * into the provider.
   */
  async resolve(picked: ModelRef | null, actor: SettingsActor): Promise<ResolvedModel> {
    let ref = picked;
    if (ref === null) {
      const writer = (await this.get(actor)).roles.find((role) => role.role === 'writer');
      if (writer?.kind === 'model')
        ref = { connectionId: writer.connectionId, modelId: writer.modelId };
    }
    if (ref === null) {
      throw new ModelNotConfiguredError(
        'Модель не настроена: подключите её в настройках (Модели) или задайте LLM_BASE_URL, ' +
          'LLM_MODEL и MODEL_API_KEY в .env и перезапустите API.',
      );
    }
    return this.resolveRef(ref, actor);
  }

  /**
   * The model assigned to a role, or null when the role has none and the run falls back to the
   * writer's model. Like `resolve`, the result holds the key.
   */
  async resolveRole(role: PipelineRole, actor: SettingsActor): Promise<ResolvedModel | null> {
    const assigned = (await this.get(actor)).roles.find((item) => item.role === role);
    if (assigned?.kind !== 'model') return null;
    return this.resolveRef(
      { connectionId: assigned.connectionId, modelId: assigned.modelId },
      actor,
    );
  }

  private async resolveRef(ref: ModelRef, actor: SettingsActor): Promise<ResolvedModel> {
    if (ref.connectionId === SERVER_CONNECTION_ID) {
      const server = this.server();
      if (!server) {
        throw new ModelNotConfiguredError(
          'Серверное подключение к модели больше не настроено: выберите другую модель.',
        );
      }
      if (!isModelEnabled(ref.modelId, await this.store.getServerModels(server.baseUrl))) {
        throw new ModelNotConfiguredError(
          'Эта модель выключена в настройках подключения: выберите другую.',
        );
      }
      return {
        connectionId: SERVER_CONNECTION_ID,
        baseUrl: server.baseUrl,
        apiKey: server.apiKey,
        model: ref.modelId,
        headers: headerRecord(server.headers),
      };
    }
    const stored = await this.store.getConnection(ref.connectionId);
    // Someone else's connection is as good as removed: its key is not the actor's to use.
    if (!stored || !ModelSettingsService.visible(stored, actor)) {
      throw new ModelNotConfiguredError('Подключение выбранной модели удалено: выберите другую.');
    }
    if (
      !this.allowPrivateHosts() &&
      (await isPrivateHost(stored.baseUrl, this.checkOptions.resolve))
    ) {
      throw new ModelNotConfiguredError(
        'Адрес подключения ведёт во внутреннюю сеть, а такие адреса запрещены ' +
          '(MODEL_ALLOW_PRIVATE_HOSTS).',
      );
    }
    const apiKey = this.keyOf(stored);
    if (stored.apiKeyEncrypted !== null && apiKey === null) {
      throw new ModelNotConfiguredError(
        `Ключ подключения «${stored.name}» не читается: введите его заново в настройках.`,
      );
    }
    if (!isModelEnabled(ref.modelId, stored.enabledModels)) {
      throw new ModelNotConfiguredError(
        'Эта модель выключена в настройках подключения: выберите другую.',
      );
    }
    return {
      connectionId: stored.connectionId,
      baseUrl: stored.baseUrl,
      apiKey: apiKey ?? '',
      model: ref.modelId,
      headers: headerRecord(stored.headers),
    };
  }
}
