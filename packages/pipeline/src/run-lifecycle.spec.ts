import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from '@lct/run-store';
import { RunLifecycle } from './run-lifecycle.js';

const revisions = [
  { kind: 'engine' as const, id: 'engine', version: '0.1.0', hash: 'a'.repeat(64) },
];

describe('RunLifecycle', () => {
  it('records stage progress and writes a validated manifest', async () => {
    const repository = new MemoryRunRepository(() => 'run-lifecycle');
    const run = await repository.create();
    const directory = await mkdtemp(join(tmpdir(), 'lct-run-'));
    const result = await new RunLifecycle({
      repository,
      runDirectory: directory,
      templateHash: 'b'.repeat(64),
      contentPackId: 'content-1',
      planId: 'plan-1',
      seed: 1,
      revisions,
      stages: [
        {
          name: 'parsing-template',
          run: async ({ progress }) => {
            await progress(1, 1, 'parsed');
            return [];
          },
        },
      ],
    }).execute(run.runId);

    expect(result.run.state).toBe('done');
    expect(result.manifest.runId).toBe(run.runId);
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))).toMatchObject({
      runId: run.runId,
      totalMs: expect.any(Number),
    });
    await expect(repository.events(run.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'stage-progress', stage: 'parsing-template' }),
        expect.objectContaining({ type: 'done' }),
      ]),
    );
  });

  it('preserves diagnostics and failed state when a stage throws', async () => {
    const repository = new MemoryRunRepository(() => 'run-failure');
    const run = await repository.create();
    const directory = await mkdtemp(join(tmpdir(), 'lct-run-'));
    await expect(
      new RunLifecycle({
        repository,
        runDirectory: directory,
        templateHash: 'b'.repeat(64),
        contentPackId: 'content-1',
        planId: 'plan-1',
        seed: 1,
        revisions,
        stages: [
          {
            name: 'planning',
            run: async () => {
              throw new Error('provider unavailable');
            },
          },
        ],
      }).execute(run.runId),
    ).rejects.toThrow('provider unavailable');

    await expect(repository.get(run.runId)).resolves.toMatchObject({ state: 'failed' });
    expect(await readFile(join(directory, 'failure.json'), 'utf8')).toContain(
      'provider unavailable',
    );
  });
});
