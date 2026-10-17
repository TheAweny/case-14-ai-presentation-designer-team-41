import {
  NO_REASONING_CHOICE,
  enabledModelIds,
  type ModelCapabilities,
  type ModelConnection,
  type ModelKind,
  type ModelRef,
  type ModelSettings,
  type ReasoningCapability,
} from '@lct/contracts';
import type { CapabilityProbe } from '@lct/registry';
import {
  probeChat,
  probeImage,
  probeReasoning,
  probeSpeech,
  probeVision,
  type Probed,
} from './capability-probe.js';
import type { ModelSettingsStore, StoredCapability } from './model-settings-store.js';
import type {
  ModelSettingsService,
  ResolvedModel,
  SettingsActor,
} from './model-settings.service.js';

/** A single-model probe that could not finish is not repeated for this long. */
const RETRY_AFTER_MS = 60000;
/** Models probed at once while a connection is classified: gateways limit parallel requests. */
const MODELS_AT_ONCE = 3;

/** How far the classification of one connection has got. */
interface Progress {
  done: number;
  readonly total: number;
}

/** The kinds a probed model was found to be; none for a model nothing was settled about yet. */
export function kindsOf(found: StoredCapability): ModelKind[] {
  const kinds: ModelKind[] = [];
  if (found.chat) kinds.push('text');
  if (found.chat && found.vision) kinds.push('vision');
  if (found.image) kinds.push('image');
  if (found.speech) kinds.push('speech');
  return kinds;
}

/**
 * What models can do, learnt by asking them (`capability-probe.ts`) and kept by server address
 * and model id. Every model of a connection is probed when the connection is added and when the
 * person checks it again; in between the findings stand and nothing is asked twice. A model
 * that is used but was never probed (an id typed by hand) is probed once on first use.
 */
export class ModelCapabilityService {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly failedAt = new Map<string, number>();
  private readonly progress = new Map<string, Progress>();

  constructor(
    private readonly store: ModelSettingsStore,
    private readonly settings: ModelSettingsService,
    private readonly prompts: () => Promise<CapabilityProbe>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Probes every offered model of a connection, in the background. `force` asks again about
   * models already probed: the person pressed "check". Without it only models with nothing
   * stored are asked. Resolves when the whole connection is done.
   */
  classify(connectionId: string, actor: SettingsActor, force: boolean): Promise<void> {
    const key = `classify ${connectionId}`;
    const current = this.running.get(key) as Promise<void> | undefined;
    if (current) return current;
    // Shown as "probing" at once, so the answer to the save or the check already says so.
    this.progress.set(connectionId, { done: 0, total: 1 });
    const run = this.classifyNow(connectionId, actor, force)
      .catch(() => undefined)
      .finally(() => {
        this.running.delete(key);
        this.progress.delete(connectionId);
      });
    this.running.set(key, run);
    return run;
  }

  private async classifyNow(connectionId: string, actor: SettingsActor, force: boolean) {
    const settings = await this.settings.get(actor);
    const connection = settings.connections.find((item) => item.connectionId === connectionId);
    if (!connection?.lastCheck?.ok) return;
    const offered = enabledModelIds(connection.lastCheck.models, connection.enabledModels ?? null);
    const stored = await this.store.listCapabilities(connection.baseUrl);
    const models = force ? [...offered] : offered.filter((modelId) => !stored.has(modelId));
    if (models.length === 0) return;
    const progress: Progress = { done: 0, total: models.length };
    this.progress.set(connectionId, progress);
    const prompts = await this.prompts();
    let next = 0;
    const worker = async () => {
      while (next < models.length) {
        const modelId = models[next++];
        if (modelId === undefined) break;
        const model = await this.settings
          .resolve({ connectionId, modelId }, actor)
          .catch(() => null);
        if (model) await this.probeModel(model, prompts).catch(() => undefined);
        progress.done++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(MODELS_AT_ONCE, models.length) }, worker));
  }

  /** Everything that can be learnt about one model; what was settled is kept. */
  private async probeModel(model: ResolvedModel, prompts: CapabilityProbe): Promise<void> {
    const value = <T>(probed: Probed<T>) => (probed.known ? probed.value : undefined);
    const [chat, image, speech] = await Promise.all([
      probeChat(model, prompts.chat, this.fetchImpl),
      probeImage(model, prompts.image, this.fetchImpl),
      probeSpeech(model, this.fetchImpl),
    ]);
    const talks = value(chat);
    // Only a model that chats can see a picture in a message or think before its answer.
    const [vision, reasoning] = talks
      ? await Promise.all([
          probeVision(model, prompts.vision, this.fetchImpl),
          probeReasoning(model, prompts.question, this.fetchImpl),
        ])
      : [
          { known: talks === false, value: false } as Probed<boolean>,
          { known: talks === false, value: NO_REASONING_CHOICE } as Probed<ReasoningCapability>,
        ];
    const found = {
      chat: talks,
      vision: value(vision),
      image: value(image),
      speech: value(speech),
      reasoning: value(reasoning),
    };
    const settledFields = Object.fromEntries(
      Object.entries(found).filter(([, settled]) => settled !== undefined),
    );
    if (Object.keys(settledFields).length === 0) return;
    await this.store.saveCapability(model.baseUrl, model.model, {
      ...settledFields,
      probeVersion: prompts.version,
    });
  }

  /**
   * The settings with what each model was found to be, and how far a running classification
   * has got. A checked connection none of whose models was ever probed (added before probing
   * existed) is classified now, once.
   */
  async withKinds(settings: ModelSettings, actor: SettingsActor): Promise<ModelSettings> {
    const connections = await Promise.all(
      settings.connections.map(async (connection): Promise<ModelConnection> => {
        if (!connection.lastCheck?.ok) return connection;
        const stored = await this.store.listCapabilities(connection.baseUrl);
        const offered = enabledModelIds(
          connection.lastCheck.models,
          connection.enabledModels ?? null,
        );
        if (offered.length > 0 && !offered.some((modelId) => stored.has(modelId))) {
          void this.classify(connection.connectionId, actor, false);
        }
        const modelKinds: Record<string, ModelKind[]> = {};
        for (const modelId of offered) {
          const found = stored.get(modelId);
          if (found) modelKinds[modelId] = kindsOf(found);
        }
        const progress = this.progress.get(connection.connectionId);
        return {
          ...connection,
          modelKinds,
          ...(progress ? { probing: { done: progress.done, total: progress.total } } : {}),
        };
      }),
    );
    return { ...settings, connections };
  }

  /** How thinking can be chosen for a resolved model; no choice while that is unknown. */
  async reasoningOf(model: ResolvedModel): Promise<ReasoningCapability> {
    return (await this.reasoning(model)) ?? NO_REASONING_CHOICE;
  }

  /** The stored finding, or a probe of a model nobody probed yet (an id typed by hand). */
  private async reasoning(model: ResolvedModel): Promise<ReasoningCapability | null> {
    const stored = await this.store.getCapability(model.baseUrl, model.model);
    if (stored?.reasoning) return stored.reasoning;
    if (stored?.chat === false) return NO_REASONING_CHOICE;
    const key = `reasoning ${model.baseUrl} ${model.model}`;
    const failed = this.failedAt.get(key);
    if (failed !== undefined && this.now() - failed < RETRY_AFTER_MS) return null;
    let pending = this.running.get(key) as Promise<Probed<ReasoningCapability>> | undefined;
    if (!pending) {
      pending = this.prompts().then(({ question }) =>
        probeReasoning(model, question, this.fetchImpl),
      );
      this.running.set(key, pending);
      void pending.finally(() => this.running.delete(key)).catch(() => undefined);
    }
    const found = await pending.catch((): Probed<ReasoningCapability> => ({ known: false }));
    if (!found.known) {
      this.failedAt.set(key, this.now());
      return null;
    }
    this.failedAt.delete(key);
    await this.store.saveCapability(model.baseUrl, model.model, {
      reasoning: found.value,
      probeVersion: (await this.prompts()).version,
    });
    return found.value;
  }

  /** What the composer shows for a model the person may use. */
  async capabilitiesOf(ref: ModelRef, actor: SettingsActor): Promise<ModelCapabilities> {
    const model = await this.settings.resolve(ref, actor);
    const reasoning = await this.reasoning(model);
    return { reasoning: reasoning ?? NO_REASONING_CHOICE, probed: reasoning !== null };
  }

  /**
   * Who transcribes dictation for this person: the model assigned to `speech`; without one, the
   * first model of their connections that transcribed the probe recording. `disabled` switches
   * dictation off. Null: there is no such model, or the connections are still being probed.
   */
  async speechModel(actor: SettingsActor): Promise<ResolvedModel | null> {
    const settings = await this.settings.get(actor);
    const assigned = settings.roles.find((item) => item.role === 'speech');
    if (assigned?.kind === 'disabled') return null;
    if (assigned?.kind === 'model') {
      return this.settings.resolve(
        { connectionId: assigned.connectionId, modelId: assigned.modelId },
        actor,
      );
    }
    for (const connection of settings.connections) {
      if (!connection.lastCheck?.ok) continue;
      const stored = await this.store.listCapabilities(connection.baseUrl);
      const offered = enabledModelIds(
        connection.lastCheck.models,
        connection.enabledModels ?? null,
      );
      const modelId = offered.find((id) => stored.get(id)?.speech === true);
      if (modelId) {
        return this.settings.resolve({ connectionId: connection.connectionId, modelId }, actor);
      }
    }
    return null;
  }
}
