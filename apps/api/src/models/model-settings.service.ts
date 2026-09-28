import { randomUUID } from 'node:crypto';
import {
  PIPELINE_ROLES,
  SERVER_CONNECTION_ID,
  baseUrlProblem,
  connectionInputProblems,
  connectionInputSchema,
  hasProblems,
  isRoleOptional,
  keyHint,
  normalizeBaseUrl,
  probeInputSchema,
  roleAssignmentSchema,
  type ConnectionCheck,
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

/** The connection comes from the server environment and cannot be changed here. */
export class ManagedConnectionError extends Error {
  override readonly name = 'ManagedConnectionError';
  constructor() {
    super('The server connection is configured in .env and cannot be changed from the interface.');
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
}

/** Roles the server connection performs until someone assigns another model. */
const SERVER_DEFAULT_ROLES: readonly PipelineRole[] = ['planner', 'writer', 'critic'];

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
  private server(): { baseUrl: string; model: string; apiKey: string } | null {
    const baseUrl = this.env.LLM_BASE_URL?.trim() ?? '';
    const model = this.env.LLM_MODEL?.trim() ?? '';
    if (!baseUrl || !model || baseUrlProblem(baseUrl)) return null;
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      model,
      apiKey: this.env.MODEL_API_KEY?.trim() ?? '',
    };
  }

  private serverView(): ModelConnection | null {
    const server = this.server();
    if (!server) return null;
    return {
      connectionId: SERVER_CONNECTION_ID,
      name: new URL(server.baseUrl).hostname,
      preset: 'custom',
      baseUrl: server.baseUrl,
      hasKey: server.apiKey !== '',
      keyHint: keyHint(server.apiKey || null),
      lastCheck: this.serverCheck,
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

  private publicView(stored: StoredConnection): ModelConnection {
    // A key that no longer decrypts shows as missing: the person enters it again.
    const key = this.keyOf(stored);
    return {
      connectionId: stored.connectionId,
      name: stored.name,
      preset: stored.preset,
      baseUrl: stored.baseUrl,
      hasKey: key !== null,
      keyHint: keyHint(key),
      lastCheck: stored.lastCheck,
      managed: false,
    };
  }

  private async find(connectionId: string): Promise<StoredConnection> {
    if (connectionId === SERVER_CONNECTION_ID) throw new ManagedConnectionError();
    const stored = await this.store.getConnection(connectionId);
    if (!stored) throw new ModelConnectionNotFoundError(connectionId);
    return stored;
  }

  private async exists(connectionId: string): Promise<boolean> {
    if (connectionId === SERVER_CONNECTION_ID) return this.server() !== null;
    return (await this.store.getConnection(connectionId)) !== null;
  }

  private allowPrivateHosts(): boolean {
    return this.checkOptions.allowPrivateHosts ?? false;
  }

  async get(): Promise<ModelSettings> {
    const server = this.serverView();
    const stored = await this.store.listConnections();
    const connections = [...(server ? [server] : []), ...stored.map((c) => this.publicView(c))];
    const ids = new Set(connections.map((connection) => connection.connectionId));
    const roles = new Map((await this.store.listRoles()).map((role) => [role.role, role]));
    return {
      connections,
      roles: PIPELINE_ROLES.map((role): RoleAssignment => {
        const assigned = roles.get(role);
        if (assigned && (assigned.kind === 'disabled' || ids.has(assigned.connectionId))) {
          return assigned;
        }
        const model = this.server()?.model;
        return model && SERVER_DEFAULT_ROLES.includes(role)
          ? { role, kind: 'model', connectionId: SERVER_CONNECTION_ID, modelId: model }
          : { role, kind: 'unassigned' };
      }),
    };
  }

  async saveConnection(raw: unknown, userId: string | null): Promise<ModelConnection> {
    const parsed = connectionInputSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const input = parsed.data;
    const problems = connectionInputProblems(input);
    if (hasProblems(problems)) throw new InvalidModelSettingsInputError(problems);

    const previous = input.connectionId === undefined ? null : await this.find(input.connectionId);
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
    // The old check speaks of the old address and key: after either changes it is no longer true.
    const unchanged = previous !== null && previous.baseUrl === baseUrl && !keyChanged;
    const lastCheck = input.lastCheck ?? (unchanged ? previous.lastCheck : null);

    const stored: StoredConnection = {
      connectionId,
      name: input.name.trim(),
      preset: input.preset,
      baseUrl,
      apiKeyEncrypted,
      lastCheck,
    };
    await this.store.saveConnection(stored);
    await this.store.record({
      userId,
      action: previous ? 'connection-updated' : 'connection-created',
      connectionId,
      detail: { keyChanged, baseUrlChanged: previous !== null && previous.baseUrl !== baseUrl },
    });
    return this.publicView(stored);
  }

  async deleteConnection(connectionId: string, userId: string | null): Promise<void> {
    if (connectionId === SERVER_CONNECTION_ID) throw new ManagedConnectionError();
    if (!(await this.store.deleteConnection(connectionId))) {
      throw new ModelConnectionNotFoundError(connectionId);
    }
    await this.store.record({ userId, action: 'connection-deleted', connectionId });
  }

  async checkConnection(connectionId: string): Promise<ModelConnection> {
    if (connectionId === SERVER_CONNECTION_ID) {
      const server = this.server();
      if (!server) throw new ModelConnectionNotFoundError(connectionId);
      // The server connection is set by whoever runs the product, so its address is trusted.
      this.serverCheck = await checkModelConnection(
        { baseUrl: server.baseUrl, apiKey: server.apiKey || null },
        { ...this.checkOptions, allowPrivateHosts: true },
      );
      const view = this.serverView();
      if (!view) throw new ModelConnectionNotFoundError(connectionId);
      return view;
    }
    const stored = await this.find(connectionId);
    const lastCheck = await checkModelConnection(
      { baseUrl: stored.baseUrl, apiKey: this.keyOf(stored) },
      this.checkOptions,
    );
    // The connection may have been edited or removed meanwhile: the outcome belongs to the same one.
    const current = await this.store.getConnection(connectionId);
    if (!current) throw new ModelConnectionNotFoundError(connectionId);
    if (current.baseUrl !== stored.baseUrl || current.apiKeyEncrypted !== stored.apiKeyEncrypted) {
      return this.publicView(current);
    }
    const checked = { ...current, lastCheck };
    await this.store.saveConnection(checked);
    return this.publicView(checked);
  }

  async probe(raw: unknown): Promise<ConnectionCheck> {
    const parsed = probeInputSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const input = parsed.data;
    const problem = baseUrlProblem(input.baseUrl);
    if (problem) throw new InvalidModelSettingsInputError({ baseUrl: problem });
    const saved = input.connectionId === undefined ? null : await this.find(input.connectionId);
    const apiKey = input.apiKey?.trim() || (saved ? this.keyOf(saved) : null);
    return checkModelConnection(
      { baseUrl: normalizeBaseUrl(input.baseUrl), apiKey },
      this.checkOptions,
    );
  }

  async setRole(raw: unknown, userId: string | null): Promise<void> {
    const parsed = roleAssignmentSchema.safeParse(raw);
    if (!parsed.success) throw new InvalidModelSettingsInputError();
    const assignment = parsed.data;
    if (assignment.kind === 'disabled' && !isRoleOptional(assignment.role)) {
      throw new InvalidModelSettingsInputError();
    }
    if (assignment.kind === 'model' && !(await this.exists(assignment.connectionId))) {
      throw new ModelConnectionNotFoundError(assignment.connectionId);
    }
    if (assignment.kind === 'unassigned') await this.store.clearRole(assignment.role);
    else await this.store.setRole(assignment satisfies StoredRole);
    await this.store.record({
      userId,
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
  async resolve(picked: ModelRef | null): Promise<ResolvedModel> {
    let ref = picked;
    if (ref === null) {
      const writer = (await this.get()).roles.find((role) => role.role === 'writer');
      if (writer?.kind === 'model')
        ref = { connectionId: writer.connectionId, modelId: writer.modelId };
    }
    if (ref === null) {
      throw new ModelNotConfiguredError(
        'Модель не настроена: подключите её в настройках (Модели) или задайте LLM_BASE_URL, ' +
          'LLM_MODEL и MODEL_API_KEY в .env и перезапустите API.',
      );
    }
    return this.resolveRef(ref);
  }

  /**
   * The model assigned to a role, or null when the role has none and the run falls back to the
   * writer's model. Like `resolve`, the result holds the key.
   */
  async resolveRole(role: PipelineRole): Promise<ResolvedModel | null> {
    const assigned = (await this.get()).roles.find((item) => item.role === role);
    if (assigned?.kind !== 'model') return null;
    return this.resolveRef({ connectionId: assigned.connectionId, modelId: assigned.modelId });
  }

  private async resolveRef(ref: ModelRef): Promise<ResolvedModel> {
    if (ref.connectionId === SERVER_CONNECTION_ID) {
      const server = this.server();
      if (!server) {
        throw new ModelNotConfiguredError(
          'Серверное подключение к модели больше не настроено: выберите другую модель.',
        );
      }
      return { connectionId: SERVER_CONNECTION_ID, ...server, model: ref.modelId };
    }
    const stored = await this.store.getConnection(ref.connectionId);
    if (!stored) {
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
    return {
      connectionId: stored.connectionId,
      baseUrl: stored.baseUrl,
      apiKey: apiKey ?? '',
      model: ref.modelId,
    };
  }
}
