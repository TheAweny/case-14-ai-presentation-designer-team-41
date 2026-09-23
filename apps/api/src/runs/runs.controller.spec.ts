import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunRepository } from '@lct/run-store';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

const roots: string[] = [];

async function controller(): Promise<RunsController> {
  const root = await mkdtemp(join(tmpdir(), 'lct-runs-controller-'));
  roots.push(root);
  return new RunsController(new RunsService(new RunRepository(root, () => 'run-api')));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('RunsController', () => {
  it('creates a real queued local run', async () => {
    const runs = await controller();

    await expect(runs.create()).resolves.toMatchObject({ runId: 'run-api', state: 'queued' });
  });

  it('returns the persisted state of a created run', async () => {
    const runs = await controller();
    await runs.create();

    await expect(runs.status('run-api')).resolves.toMatchObject({ state: 'queued' });
  });
});
