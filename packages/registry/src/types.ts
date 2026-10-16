import type { AgentConfig } from '@lct/contracts';

/** An agent definition as it sits on disk: config plus the prompt file next to it. */
export interface LoadedAgent {
  readonly config: AgentConfig;
  readonly instructions: string;
  readonly directory: string;
}

/** One entry of the run manifest: what exactly produced a given run. */
export interface AgentManifestEntry {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly modelId: string;
  readonly instructionsSha256: string;
}

/** One model a run used, pinned to the weights that answered. */
export interface ModelManifestEntry {
  readonly modelId: string;
  readonly repo: string;
  readonly revision: string;
  readonly provider: string;
}

/** Everything needed to explain — and repeat — a run. */
export interface RunManifest {
  readonly runId: string;
  readonly createdAt: string;
  readonly seed: number;
  readonly agents: readonly AgentManifestEntry[];
  readonly models: readonly ModelManifestEntry[];
}

/**
 * The prompts every generation agent shares: the answer format, with `{{schema}}` for the JSON
 * Schema of the answer, and the request to repair an answer, with `{{problems}}`.
 */
export interface AnswerFormat {
  readonly version: string;
  readonly format: string;
  readonly repair: string;
}
