import { randomUUID } from 'node:crypto';
import {
  InvalidRunTransitionError,
  RunNotFoundError,
  type RunRecord,
  type RunRepository,
  type RunState,
} from './run-repository.js';
import type { JobEvent } from '@lct/contracts';

const transitions: Record<RunState, readonly RunState[]> = {
  queued: ['running', 'failed'],
  running: ['done', 'failed'],
  done: [],
  failed: ['running'],
};

export class MemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, RunRecord>();
  private readonly eventLog = new Map<string, JobEvent[]>();

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
    this.eventLog.set(run.runId, []);
    return Promise.resolve(run);
  }

  async appendEvent(runId: string, event: JobEvent): Promise<void> {
    if (!(await this.get(runId))) {
      throw new RunNotFoundError(runId);
    }
    if (event.runId !== runId) {
      throw new Error(`Event run id ${event.runId} does not match ${runId}.`);
    }
    const events = this.eventLog.get(runId) ?? [];
    const previous = events.at(-1);
    if (previous && event.seq !== previous.seq + 1) {
      throw new Error(`Run ${runId} event sequence must be dense.`);
    }
    if (!previous && event.seq !== 0) {
      throw new Error(`Run ${runId} event sequence must start at zero.`);
    }
    events.push(event);
    this.eventLog.set(runId, events);
  }

  async events(runId: string, afterSequence = -1): Promise<readonly JobEvent[]> {
    if (!(await this.get(runId))) {
      throw new RunNotFoundError(runId);
    }
    return [...(this.eventLog.get(runId) ?? [])].filter((event) => event.seq > afterSequence);
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
