import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentGeneration } from '@lct/contracts';
import type { TextProvider } from './provider.js';
import { withAttemptTask } from '../models/attempt-context.js';

/** Sorted object keys make dependency ids independent of serialization order. */
export function dependencyKey(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** A result is visible only after the file has been fully written and synced. */
export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Minimal task persistence around the existing Mastra workflow, not a second workflow runtime. */
export class TaskCheckpoints {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    readonly directory: string,
    readonly dependencies: string,
    private readonly assertOwner: () => Promise<void> = async () => undefined,
    private readonly onReuse?: (taskId: string) => void,
  ) {}

  async once<T>(task: unknown, schema: z.ZodType<T>, compute: () => Promise<T>): Promise<T> {
    const taskId = dependencyKey({ version: 1, dependencies: this.dependencies, task });
    const existing = this.pending.get(taskId);
    if (existing) return structuredClone(await existing) as T;
    const promise = this.perform(taskId, schema, compute);
    this.pending.set(taskId, promise);
    try {
      return structuredClone(await promise);
    } catch (error) {
      this.pending.delete(taskId);
      throw error;
    }
  }

  private async perform<T>(
    taskId: string,
    schema: z.ZodType<T>,
    compute: () => Promise<T>,
  ): Promise<T> {
    await this.assertOwner();
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, `${taskId}.json`);
    let saved: unknown;
    try {
      saved = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (saved !== undefined) {
      const envelope = z.object({
        version: z.literal(1),
        taskId: z.literal(taskId),
        value: schema,
      });
      const parsed = envelope.parse(saved);
      this.onReuse?.(taskId);
      return parsed.value;
    }
    const result = schema.parse(await withAttemptTask(taskId, compute));
    // A cancelled/stale executor cannot publish a response received after lease loss.
    await this.assertOwner();
    await atomicJson(path, { version: 1, taskId, value: result });
    await this.assertOwner();
    return result;
  }
}

/** Every accepted model task is kept before downstream code can export or publish it. */
export class CheckpointTextProvider implements TextProvider {
  readonly model: string;
  constructor(
    private readonly inner: TextProvider,
    private readonly checkpoints: TaskCheckpoints,
  ) {
    this.model = inner.model;
  }
  get calls() {
    return this.inner.calls ?? [];
  }
  setAgentGeneration(agent: string, generation: AgentGeneration): void {
    this.inner.setAgentGeneration?.(agent, generation);
  }
  generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    return this.checkpoints
      .once(
        { agent, model: this.model, instructions, input, schema: z.toJSONSchema(schema) },
        schema,
        () => this.inner.generate(agent, instructions, input, schema, signal),
      )
      .then((result) => {
        signal.throwIfAborted();
        return result;
      });
  }
}
