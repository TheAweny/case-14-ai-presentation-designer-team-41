import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InvalidRunTransitionError, RunRepository, type RunState } from './run-repository.js';

const roots: string[] = [];

async function repository(): Promise<RunRepository> {
  const root = await mkdtemp(join(tmpdir(), 'lct-run-store-'));
  roots.push(root);
  return new RunRepository(root, () => 'run-fixture');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('RunRepository', () => {
  it('creates an isolated queued run with its artifact directories', async () => {
    const store = await repository();

    const run = await store.create();

    expect(run).toMatchObject({ runId: 'run-fixture', state: 'queued' });
    await expect(stat(join(store.rootDir, run.runId, 'inputs'))).resolves.toBeDefined();
    await expect(stat(join(store.rootDir, run.runId, 'variants'))).resolves.toBeDefined();
  });

  it('persists the run state in its own run.json file', async () => {
    const store = await repository();
    await store.create();

    const saved = JSON.parse(
      await readFile(join(store.rootDir, 'run-fixture', 'run.json'), 'utf8'),
    );

    expect(saved.state).toBe('queued');
  });

  it('loads an existing run by its stable id', async () => {
    const store = await repository();
    await store.create();

    await expect(store.get('run-fixture')).resolves.toMatchObject({ state: 'queued' });
  });

  it('returns null for a run that does not exist', async () => {
    const store = await repository();

    await expect(store.get('run-missing')).resolves.toBeNull();
  });

  it('allows a queued run to move through the local lifecycle', async () => {
    const store = await repository();
    await store.create();

    const running = await store.transition('run-fixture', 'running');
    const complete = await store.transition('run-fixture', 'done');

    expect(running.state).toBe('running');
    expect(complete.state).toBe('done');
  });

  it('rejects transitions out of a terminal state', async () => {
    const store = await repository();
    await store.create();
    await store.transition('run-fixture', 'running');
    await store.transition('run-fixture', 'failed');

    await expect(store.transition('run-fixture', 'done')).rejects.toBeInstanceOf(
      InvalidRunTransitionError,
    );
  });

  it.each<readonly [RunState, RunState]>([
    ['queued', 'done'],
    ['done', 'running'],
  ])('rejects invalid %s to %s transitions', async (from, to) => {
    const store = await repository();
    await store.create();
    if (from === 'done') {
      await store.transition('run-fixture', 'running');
      await store.transition('run-fixture', 'done');
    }

    await expect(store.transition('run-fixture', to)).rejects.toBeInstanceOf(
      InvalidRunTransitionError,
    );
  });
});
