import {
  MODEL_KINDS,
  NO_REASONING_CHOICE,
  connectionModelIds,
  modelKindsOf,
  type ModelCapabilities,
  type ModelConnection,
  type ModelKind,
  type ModelRef,
  type ModelSettings,
  type ReasoningCapability,
} from '@lct/contracts';
import type { CapabilityProbe } from '@lct/registry';
import { probeReasoning, type Probed } from './capability-probe.js';
import type { ModelSettingsStore } from './model-settings-store.js';
import {
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  type ModelSettingsService,
  type ResolvedModel,
  type SettingsActor,
} from './model-settings.service.js';

/** A probe that could not finish is not repeated for this long. */
const RETRY_AFTER_MS = 60000;
/** Explicit probes at once while a connection is checked. Their billing may be unknown. */
const PROBES_AT_ONCE = 4;

/**
 * What models can do. Their kind (text, pictures in, pictures out, speech) comes from what the
 * provider says in `/models`, kept with the connection check, or from what the person set by
 * hand. Nothing is learnt by making a model work: with a hundred models that is slow and costs
 * money. How a model thinks comes from the same description; where it says nothing, one bounded
 * request tells whether the server reads `reasoning_effort` (see `capability-probe.ts`). That is
 * asked when the connection is added or checked, and kept until the next check.
 */
export class ModelCapabilityService {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly store: ModelSettingsStore,
    private readonly settings: ModelSettingsService,
    private readonly prompts: () => Promise<CapabilityProbe>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly probeTransport?: (ownerId: string, model: ResolvedModel) => typeof fetch,
  ) {}

  /**
   * Settles how each chat model of a connection thinks, in the background: the provider's word
   * where it gave one, an explicit probe elsewhere. `force` asks again (the person checked the
   * connection); without it only models with nothing stored are asked.
   */
  check(connectionId: string, actor: SettingsActor, force: boolean): Promise<void> {
    const key = `check ${connectionId}`;
    const current = this.running.get(key) as Promise<void> | undefined;
    if (current) return current;
    const run = this.checkNow(connectionId, actor, force)
      .catch(() => undefined)
      .finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  private async checkNow(connectionId: string, actor: SettingsActor, force: boolean) {
    const connection = await this.connection(connectionId, actor);
    if (!connection?.lastCheck?.ok) return;
    const { details } = connection.lastCheck;
    const stored = await this.store.listCapabilities(connection);
    const { version } = await this.prompts();
    const chatModels = this.offered(connection).filter((modelId) =>
      modelKindsOf(connection, modelId).kinds.includes('text'),
    );
    const unknown: string[] = [];
    for (const modelId of chatModels) {
      const described = details?.[modelId]?.reasoning;
      if (described) {
        await this.store.saveReasoning(connection, modelId, described, version);
      } else if (force || !stored.get(modelId)?.reasoning) {
        unknown.push(modelId);
      }
    }
    // Native Messages capabilities come from its Models API, never paid chat-completion probes.
    if (connection.preset === 'anthropic') return;
    let next = 0;
    const worker = async () => {
      while (next < unknown.length) {
        const modelId = unknown[next++];
        if (modelId === undefined) break;
        const model = await this.settings
          .resolve({ connectionId, modelId }, actor)
          .catch(() => null);
        if (model) await this.reasoning(model, true, actor.userId);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PROBES_AT_ONCE, unknown.length) }, worker));
  }

  private async connection(
    connectionId: string,
    actor: SettingsActor,
  ): Promise<ModelConnection | undefined> {
    const settings = await this.settings.get(actor);
    return settings.connections.find((item) => item.connectionId === connectionId);
  }

  private offered(connection: ModelConnection): readonly string[] {
    return connectionModelIds(connection);
  }

  /** The settings with the kinds the person set by hand on each connection. */
  async withManualKinds(settings: ModelSettings, _actor: SettingsActor): Promise<ModelSettings> {
    const connections = await Promise.all(
      settings.connections.map(async (connection): Promise<ModelConnection> => {
        const stored = await this.store.listCapabilities(connection);
        const manualKinds: Record<string, ModelKind[]> = {};
        for (const [modelId, found] of stored) {
          if (found.manualKinds) manualKinds[modelId] = [...found.manualKinds];
        }
        return { ...connection, manualKinds };
      }),
    );
    return { ...settings, connections };
  }

  /**
   * Sets what a model of a connection is, by hand; null goes back to the provider's word. Only
   * whoever may change the connection may change this: it applies to everyone using it.
   */
  async setManualKinds(
    connectionId: string,
    modelId: string,
    kinds: readonly ModelKind[] | null,
    actor: SettingsActor,
  ): Promise<void> {
    const connection = await this.connection(connectionId, actor);
    if (!connection) throw new ModelConnectionNotFoundError(connectionId);
    const mayChange =
      connection.managed || connection.shared ? actor.admin : connection.editable !== false;
    if (!mayChange)
      throw new ManagedConnectionError('Only an administrator changes this connection.');
    const known = kinds === null ? null : MODEL_KINDS.filter((kind) => kinds.includes(kind));
    // Seeing pictures is a kind of chatting: a VLM without text is a text model that sees.
    const normalised =
      known !== null && known.includes('vision') && !known.includes('text')
        ? (['text', ...known] as ModelKind[])
        : known;
    await this.store.setManualKinds(connection, modelId, normalised);
  }

  /** How thinking can be chosen for a resolved model; no choice while that is unknown. */
  async reasoningOf(model: ResolvedModel): Promise<ReasoningCapability> {
    if (model.protocol === 'anthropic') {
      const connection = await this.store.getConnection(model.connectionId);
      return connection?.baseUrl === model.baseUrl && connection.lastCheck?.ok
        ? (connection.lastCheck.details?.[model.model]?.reasoning ?? NO_REASONING_CHOICE)
        : NO_REASONING_CHOICE;
    }
    return (await this.store.getCapability(model, model.model))?.reasoning ?? NO_REASONING_CHOICE;
  }

  /** The stored finding, or an explicit probe whose usage and charge may be unknown. */
  private async reasoning(
    model: ResolvedModel,
    force: boolean,
    ownerId: string,
  ): Promise<ReasoningCapability | null> {
    if (!force) {
      const stored = await this.store.getCapability(model, model.model);
      if (stored?.reasoning) return stored.reasoning;
    }
    const key = `reasoning ${model.connectionId} ${model.baseUrl} ${model.model}`;
    const failed = this.failedAt.get(key);
    if (!force && failed !== undefined && this.now() - failed < RETRY_AFTER_MS) return null;
    let pending = this.running.get(key) as Promise<Probed<ReasoningCapability | null>> | undefined;
    if (!pending) {
      pending = this.prompts().then(({ prompt }) =>
        probeReasoning(model, prompt, this.probeTransport?.(ownerId, model) ?? this.fetchImpl),
      );
      this.running.set(key, pending);
      void pending.finally(() => this.running.delete(key)).catch(() => undefined);
    }
    const found = await pending.catch((): Probed<ReasoningCapability | null> => ({
      known: false,
    }));
    if (!found.known) {
      this.failedAt.set(key, this.now());
      return null;
    }
    this.failedAt.delete(key);
    const reasoning = found.value ?? NO_REASONING_CHOICE;
    await this.store.saveReasoning(model, model.model, reasoning, (await this.prompts()).version);
    return reasoning;
  }

  /** What the composer shows for a model the person may use. */
  async capabilitiesOf(ref: ModelRef, actor: SettingsActor): Promise<ModelCapabilities> {
    const model = await this.settings.resolve(ref, actor);
    if (model.protocol === 'anthropic') {
      const connection = await this.connection(model.connectionId, actor);
      const described = connection?.lastCheck?.ok
        ? connection.lastCheck.details?.[model.model]?.reasoning
        : undefined;
      return { reasoning: described ?? NO_REASONING_CHOICE, probed: described !== undefined };
    }
    const reasoning = (await this.store.getCapability(model, model.model))?.reasoning ?? null;
    return { reasoning: reasoning ?? NO_REASONING_CHOICE, probed: reasoning !== null };
  }

  /**
   * Who transcribes dictation for this person: the model assigned to `speech`; without one, the
   * first model of their connections that the provider describes, or the person marked, as a
   * speech model. `disabled` switches dictation off.
   */
  async speechModel(actor: SettingsActor): Promise<ResolvedModel | null> {
    const settings = await this.withManualKinds(await this.settings.get(actor), actor);
    const assigned = settings.roles.find((item) => item.role === 'speech');
    if (assigned?.kind === 'disabled') return null;
    if (assigned?.kind === 'model') {
      return this.settings.resolve(
        { connectionId: assigned.connectionId, modelId: assigned.modelId },
        actor,
      );
    }
    if (this.settings.mediaDisabled('speech')) return null;
    const server = await this.settings.resolveRole('speech', actor);
    if (server) return server;
    for (const connection of settings.connections) {
      const modelId = this.offered(connection).find((id) =>
        modelKindsOf(connection, id).kinds.includes('speech'),
      );
      if (modelId) {
        return this.settings.resolve({ connectionId: connection.connectionId, modelId }, actor);
      }
    }
    return null;
  }
}
