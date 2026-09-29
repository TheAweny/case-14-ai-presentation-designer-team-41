import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MemoryRunRepository } from '@lct/run-store';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';
import type { Account } from '../accounts/account-rules.js';

const account: Account = {
  id: 'user-1',
  email: 'ann@example.com',
  name: 'Ann',
  role: 'user',
  disabled: false,
  createdAt: '2026-09-29T00:00:00.000Z',
};

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

    await expect(runs.status('run-api', account)).resolves.toMatchObject({ state: 'queued' });
  });

  it('rejects an invalid local input configuration before a run starts', () => {
    const runs = controller();

    expect(() => runs.validateInputs({})).toThrow(BadRequestException);
  });

  it('returns an empty persisted event journal for a new run', async () => {
    const runs = controller();
    await runs.create();

    await expect(runs.events('run-api', account)).resolves.toEqual([]);
  });

  it('rejects an invalid event cursor', async () => {
    const runs = controller();
    await runs.create();

    await expect(runs.events('run-api', account, 'nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
