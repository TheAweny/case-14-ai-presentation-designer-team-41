import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from '@lct/run-store';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';

function controller(): RunsController {
  return new RunsController(new RunsService(new MemoryRunRepository(() => 'run-api')));
}

describe('RunsController', () => {
  it('creates a real queued local run', async () => {
    const runs = controller();

    await expect(runs.create()).resolves.toMatchObject({ runId: 'run-api', state: 'queued' });
  });

  it('returns the persisted state of a created run', async () => {
    const runs = controller();
    await runs.create();

    await expect(runs.status('run-api')).resolves.toMatchObject({ state: 'queued' });
  });
});
