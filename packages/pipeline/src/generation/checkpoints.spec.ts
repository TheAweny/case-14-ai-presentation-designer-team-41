import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CheckpointTextProvider, TaskCheckpoints, dependencyKey } from './checkpoints.js';

const roots: string[] = [];
const schema = z.object({ text: z.string() });
async function store(dependencies = 'spec-v1', guard?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'task-checkpoint-'));
  roots.push(root);
  return new TaskCheckpoints(root, dependencies, guard);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('accepted task checkpoints', () => {
  it('resumes after slide 7 without repeating the planner or seven accepted slides', async () => {
    const checkpoints = await store();
    const send = vi.fn(async () => ({ text: 'Принятый факт: 18 % за 2026 год' }));
    const provider = {
      model: 'fake',
      async generate<T>(
        _agent: string,
        _instructions: string,
        _input: unknown,
        output: z.ZodType<T>,
      ) {
        return output.parse(await send());
      },
    };
    const first = new CheckpointTextProvider(provider, checkpoints);
    for (const agent of ['planner', ...Array.from({ length: 7 }, () => 'writer')]) {
      const index = send.mock.calls.length;
      await first.generate(
        agent,
        'registry prompt',
        { index },
        schema,
        new AbortController().signal,
      );
    }
    const resumed = new CheckpointTextProvider(
      provider,
      new TaskCheckpoints(checkpoints.directory, checkpoints.dependencies),
    );
    for (let index = 0; index < 11; index++)
      await resumed.generate(
        index === 0 ? 'planner' : 'writer',
        'registry prompt',
        { index },
        schema,
        new AbortController().signal,
      );
    expect(send).toHaveBeenCalledTimes(11);
  });

  it('deduplicates concurrent tasks and isolates mutable consumers', async () => {
    const checkpoints = await store();
    const compute = vi.fn(async () => ({ text: '18 %' }));
    const [a, b] = await Promise.all([
      checkpoints.once('slide-7', schema, compute),
      checkpoints.once('slide-7', schema, compute),
    ]);
    a.text = 'changed';
    expect(b.text).toBe('18 %');
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not accept invalid results and retries only the failed task', async () => {
    const checkpoints = await store();
    await checkpoints.once('good', schema, async () => ({ text: 'source' }));
    await expect(
      checkpoints.once('bad', schema, async () => ({ text: 7 }) as never),
    ).rejects.toThrow();
    expect(await readdir(checkpoints.directory)).toHaveLength(1);
    expect(await checkpoints.once('bad', schema, async () => ({ text: 'fixed' }))).toEqual({
      text: 'fixed',
    });
  });

  it('invalidates dependencies and refuses a corrupted file instead of silently charging again', async () => {
    const checkpoints = await store();
    const compute = vi.fn(async () => ({ text: 'source' }));
    await checkpoints.once('task', schema, compute);
    const changed = new TaskCheckpoints(checkpoints.directory, 'spec-v2');
    await changed.once('task', schema, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    const file = (await readdir(checkpoints.directory))[0];
    if (!file) throw new Error('Missing checkpoint');
    await writeFile(join(checkpoints.directory, file), '{}');
    const a = new TaskCheckpoints(checkpoints.directory, checkpoints.dependencies);
    const b = new TaskCheckpoints(checkpoints.directory, 'spec-v2');
    const outcomes = await Promise.allSettled([
      a.once('task', schema, compute),
      b.once('task', schema, compute),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'rejected')).toBe(true);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('fences a stale response before persistence', async () => {
    let current = true;
    const checkpoints = await store('v1', async () => {
      if (!current) throw new Error('Lease lost');
    });
    await expect(
      checkpoints.once('task', schema, async () => {
        current = false;
        return { text: 'stale' };
      }),
    ).rejects.toThrow('Lease lost');
    expect(await readdir(checkpoints.directory)).toHaveLength(0);
  });

  it('keys schema/prompt/template/model policy/seed/content independently of property order', () => {
    const base = {
      schema: 'v1',
      prompt: 'v1',
      template: 'hash',
      modelPolicy: 'writer',
      seed: 42,
      content: 'fact',
    };
    expect(dependencyKey(base)).toBe(
      dependencyKey(Object.fromEntries(Object.entries(base).reverse())),
    );
    for (const key of Object.keys(base))
      expect(dependencyKey({ ...base, [key]: 'different' })).not.toBe(dependencyKey(base));
  });
});
