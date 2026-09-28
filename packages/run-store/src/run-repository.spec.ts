import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from './memory-run-repository.js';
import { InvalidRunTransitionError, type RunState } from './run-repository.js';

describe('RunRepository contract', () => {
  it('creates a queued run with lifecycle timestamps', async () => {
    const store = new MemoryRunRepository(() => 'run-fixture');

    await expect(store.create()).resolves.toMatchObject({
      runId: 'run-fixture',
      state: 'queued',
      startedAt: null,
      completedAt: null,
    });
  });

  it('loads an existing run by its stable id', async () => {
    const store = new MemoryRunRepository(() => 'run-fixture');
    await store.create();

    await expect(store.get('run-fixture')).resolves.toMatchObject({ state: 'queued' });
  });

  it('returns null for a run that does not exist', async () => {
    const store = new MemoryRunRepository();

    await expect(store.get('run-missing')).resolves.toBeNull();
  });

  it('allows a queued run to move through the lifecycle', async () => {
    const store = new MemoryRunRepository(() => 'run-fixture');
    await store.create();

    const running = await store.transition('run-fixture', 'running');
    const complete = await store.transition('run-fixture', 'done');

    expect(running.startedAt).not.toBeNull();
    expect(complete.completedAt).not.toBeNull();
  });

  it.each<readonly [RunState, RunState]>([
    ['queued', 'done'],
    ['done', 'running'],
  ])('rejects invalid %s to %s transitions', async (from, to) => {
    const store = new MemoryRunRepository(() => 'run-fixture');
    await store.create();
    if (from === 'done') {
      await store.transition('run-fixture', 'running');
      await store.transition('run-fixture', 'done');
    }

    await expect(store.transition('run-fixture', to)).rejects.toBeInstanceOf(
      InvalidRunTransitionError,
    );
  });

  it('persists a dense typed event journal and supports cursors', async () => {
    const store = new MemoryRunRepository(() => 'run-fixture');
    await store.create();
    await store.appendEvent('run-fixture', {
      schemaVersion: 1,
      runId: 'run-fixture',
      seq: 0,
      at: new Date().toISOString(),
      type: 'stage-started',
      stage: 'queued',
    });
    await store.appendEvent('run-fixture', {
      schemaVersion: 1,
      runId: 'run-fixture',
      seq: 1,
      at: new Date().toISOString(),
      type: 'stage-progress',
      stage: 'parsing-template',
      done: 1,
      total: 1,
      note: 'parsed',
    });

    await expect(store.events('run-fixture', 0)).resolves.toHaveLength(1);
    await expect(
      store.appendEvent('run-fixture', {
        schemaVersion: 1,
        runId: 'run-fixture',
        seq: 3,
        at: new Date().toISOString(),
        type: 'stage-finished',
        stage: 'parsing-template',
        durationMs: 1,
      }),
    ).rejects.toThrow('sequence must be dense');

    await expect(
      store.appendEvent('run-fixture', {
        schemaVersion: 1,
        runId: 'another-run',
        seq: 2,
        at: new Date().toISOString(),
        type: 'stage-finished',
        stage: 'parsing-template',
        durationMs: 1,
      }),
    ).rejects.toThrow('does not match');
  });
});
