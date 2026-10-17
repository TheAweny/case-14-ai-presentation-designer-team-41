import {
  NO_REASONING_CHOICE,
  enabledModelIds,
  type ModelCapabilities,
  type ModelRef,
  type ReasoningCapability,
} from '@lct/contracts';
import { probeReasoning, probeSpeech, type Probed } from './capability-probe.js';
import type { ModelSettingsStore } from './model-settings-store.js';
import type {
  ModelSettingsService,
  ResolvedModel,
  SettingsActor,
} from './model-settings.service.js';

/** The question the reasoning probe asks, with the version of the shared registry prompts. */
export interface ProbeQuestion {
  readonly version: string;
  readonly question: string;
}

/** A probe that could not finish is not repeated for this long: the provider is busy or down. */
const RETRY_AFTER_MS = 60000;
/** Speech probes at once while looking for a transcription model among a connection's models. */
const SPEECH_PROBES_AT_ONCE = 6;

/**
 * What models can do, learnt by asking them (`capability-probe.ts`) and kept by server address
 * and model id. Each model is asked once per version of the probe; concurrent askers share one
 * probe, and a probe that could not finish is retried later rather than stored.
 */
export class ModelCapabilityService {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly failedAt = new Map<string, number>();
  /** The speech model found for each account a moment ago: the composer asks on every open. */
  private readonly speechFound = new Map<string, { at: number; model: ResolvedModel | null }>();

  constructor(
    private readonly store: ModelSettingsStore,
    private readonly settings: ModelSettingsService,
    private readonly probeQuestion: () => Promise<ProbeQuestion>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The probe version stored next to each finding: a new question asks every model again. */
  private async version(): Promise<string> {
    return `probe ${(await this.probeQuestion()).version}`;
  }

  /**
   * One probe per model and question at a time, shared by everyone asking. Null: unknown now,
   * either still unsettled or failed a moment ago.
   */
  private async settle<T>(
    key: string,
    probe: () => Promise<Probed<T>>,
    save: (value: T) => Promise<void>,
  ): Promise<T | null> {
    const failed = this.failedAt.get(key);
    if (failed !== undefined && this.now() - failed < RETRY_AFTER_MS) return null;
    let pending = this.running.get(key) as Promise<Probed<T>> | undefined;
    if (!pending) {
      pending = probe();
      this.running.set(key, pending);
      void pending.finally(() => this.running.delete(key)).catch(() => undefined);
    }
    const found = await pending.catch((): Probed<T> => ({ known: false }));
    if (!found.known) {
      this.failedAt.set(key, this.now());
      return null;
    }
    this.failedAt.delete(key);
    await save(found.value);
    return found.value;
  }

  /** How thinking can be chosen for a resolved model; no choice while that is unknown. */
  async reasoningOf(model: ResolvedModel): Promise<ReasoningCapability> {
    return (await this.reasoning(model)) ?? NO_REASONING_CHOICE;
  }

  private async reasoning(model: ResolvedModel): Promise<ReasoningCapability | null> {
    const version = await this.version();
    const stored = await this.store.getCapability(model.baseUrl, model.model);
    if (stored?.probeVersion === version && stored.reasoning) return stored.reasoning;
    const { question } = await this.probeQuestion();
    return this.settle(
      `reasoning ${model.baseUrl} ${model.model}`,
      () => probeReasoning(model, question, this.fetchImpl),
      (reasoning) =>
        this.store.saveCapability(model.baseUrl, model.model, { reasoning, probeVersion: version }),
    );
  }

  /** What the composer shows for a model the person may use. Probes it on the first ask. */
  async capabilitiesOf(ref: ModelRef, actor: SettingsActor): Promise<ModelCapabilities> {
    const model = await this.settings.resolve(ref, actor);
    const reasoning = await this.reasoning(model);
    return { reasoning: reasoning ?? NO_REASONING_CHOICE, probed: reasoning !== null };
  }

  private async speech(model: ResolvedModel): Promise<boolean | null> {
    const version = await this.version();
    const stored = await this.store.getCapability(model.baseUrl, model.model);
    if (stored?.probeVersion === version && stored.speech !== undefined) return stored.speech;
    return this.settle(
      `speech ${model.baseUrl} ${model.model}`,
      () => probeSpeech(model, this.fetchImpl),
      (speech) =>
        this.store.saveCapability(model.baseUrl, model.model, { speech, probeVersion: version }),
    );
  }

  /**
   * Who transcribes dictation for this person: the model assigned to `speech`; without one, the
   * first model of their connections that really transcribed a probe recording. `disabled`
   * switches dictation off. Null: there is no such model.
   */
  async speechModel(actor: SettingsActor): Promise<ResolvedModel | null> {
    const recent = this.speechFound.get(actor.userId);
    if (recent && this.now() - recent.at < RETRY_AFTER_MS) return recent.model;
    const model = await this.findSpeechModel(actor);
    this.speechFound.set(actor.userId, { at: this.now(), model });
    return model;
  }

  /** Settings changed (a role, a connection): look for the speech model again. */
  forgetSpeechModel(actor: SettingsActor): void {
    this.speechFound.delete(actor.userId);
  }

  private async findSpeechModel(actor: SettingsActor): Promise<ResolvedModel | null> {
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
      const offered = enabledModelIds(
        connection.lastCheck.models,
        connection.enabledModels ?? null,
      );
      for (let at = 0; at < offered.length; at += SPEECH_PROBES_AT_ONCE) {
        const batch = offered.slice(at, at + SPEECH_PROBES_AT_ONCE);
        const models = await Promise.all(
          batch.map((modelId) =>
            this.settings
              .resolve({ connectionId: connection.connectionId, modelId }, actor)
              .catch(() => null),
          ),
        );
        const found = await Promise.all(
          models.map(async (model) => (model && (await this.speech(model)) ? model : null)),
        );
        const model = found.find((item) => item !== null);
        if (model) return model;
      }
    }
    return null;
  }
}
