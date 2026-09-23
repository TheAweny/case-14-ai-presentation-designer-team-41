import { randomUUID } from 'node:crypto';
import {
  InvalidRunTransitionError,
  RunNotFoundError,
  type RunRecord,
  type RunRepository,
  type RunState,
} from './run-repository.js';

const transitions: Record<RunState, readonly RunState[]> = {
  queued: ['running', 'failed'],
  running: ['done', 'failed'],
  done: [],
  failed: [],
};

export class MemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly createId: () => string = () => `run-${randomUUID()}`) {}

  create(): Promise<RunRecord> {
    const now = new Date().toISOString();
    const run: RunRecord = {
      runId: this.createId(),
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.runs.set(run.runId, run);
    return Promise.resolve(run);
  }

  get(runId: string): Promise<RunRecord | null> {
    return Promise.resolve(this.runs.get(runId) ?? null);
  }

  async transition(runId: string, state: RunState): Promise<RunRecord> {
    const current = await this.get(runId);
    if (current === null) {
      throw new RunNotFoundError(runId);
    }
    if (!transitions[current.state].includes(state)) {
      throw new InvalidRunTransitionError(runId, current.state, state);
    }
    const now = new Date().toISOString();
    const updated: RunRecord = {
      ...current,
      state,
      updatedAt: now,
      startedAt: state === 'running' ? (current.startedAt ?? now) : current.startedAt,
      completedAt: state === 'done' || state === 'failed' ? now : current.completedAt,
    };
    this.runs.set(runId, updated);
    return updated;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }
}
