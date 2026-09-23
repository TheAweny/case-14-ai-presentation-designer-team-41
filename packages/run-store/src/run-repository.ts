import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const runIdPattern = /^[a-z][a-z0-9-]*$/;
const stateTransitions = {
  queued: ['running', 'failed'],
  running: ['done', 'failed'],
  done: [],
  failed: [],
} as const;

export type RunState = keyof typeof stateTransitions;

export interface LocalRun {
  readonly runId: string;
  readonly state: RunState;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export class RunRepository {
  readonly rootDir: string;
  private readonly createId: () => string;

  constructor(rootDir: string, createId: () => string = () => `run-${randomUUID()}`) {
    this.rootDir = resolve(rootDir);
    this.createId = createId;
  }

  async create(): Promise<LocalRun> {
    const runId = this.createId();
    this.assertRunId(runId);
    const now = new Date().toISOString();
    const run: LocalRun = { runId, state: 'queued', createdAt: now, updatedAt: now };
    const directory = this.directory(runId);

    await mkdir(this.rootDir, { recursive: true });
    await mkdir(directory, { recursive: false });
    await Promise.all(
      ['inputs', 'profile', 'plan', 'variants', 'audit', 'previews'].map((name) =>
        mkdir(resolve(directory, name)),
      ),
    );
    await this.write(run);
    return run;
  }

  async get(runId: string): Promise<LocalRun | null> {
    this.assertRunId(runId);
    try {
      return JSON.parse(await readFile(this.runFile(runId), 'utf8')) as LocalRun;
    } catch (error: unknown) {
      if (this.isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  }

  async transition(runId: string, state: RunState): Promise<LocalRun> {
    const current = await this.get(runId);
    if (current === null) {
      throw new RunNotFoundError(runId);
    }
    if (!stateTransitions[current.state].includes(state as never)) {
      throw new InvalidRunTransitionError(runId, current.state, state);
    }
    const next: LocalRun = { ...current, state, updatedAt: new Date().toISOString() };
    await this.write(next);
    return next;
  }

  private async write(run: LocalRun): Promise<void> {
    const destination = this.runFile(run.runId);
    const temporary = `${destination}.tmp`;
    await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    await rename(temporary, destination);
  }

  private directory(runId: string): string {
    return resolve(this.rootDir, runId);
  }

  private runFile(runId: string): string {
    return resolve(this.directory(runId), 'run.json');
  }

  private assertRunId(runId: string): void {
    if (!runIdPattern.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`);
    }
  }

  private isMissingFile(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
}
