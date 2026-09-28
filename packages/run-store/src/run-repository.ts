import type { JobEvent } from '@lct/contracts';

export const RUN_STATES = ['queued', 'running', 'done', 'failed'] as const;

export type RunState = (typeof RUN_STATES)[number];

export interface RunRecord {
  readonly runId: string;
  readonly state: RunState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface RunRepository {
  create(): Promise<RunRecord>;
  get(runId: string): Promise<RunRecord | null>;
  transition(runId: string, state: RunState): Promise<RunRecord>;
  appendEvent(runId: string, event: JobEvent): Promise<void>;
  events(runId: string, afterSequence?: number): Promise<readonly JobEvent[]>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export class InvalidRunTransitionError extends Error {
  constructor(runId: string, from: RunState, to: RunState) {
    super(`Run ${runId} cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidRunTransitionError';
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was not found.`);
    this.name = 'RunNotFoundError';
  }
}
