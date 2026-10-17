import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRepository } from '@lct/run-store';
import type { Account } from '../accounts/account-rules.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { GenerationService, type StartedBuild } from './generation.service.js';

const RUN = 'run-00000000-0000-4000-8000-0000000000f1';
const BUILD = '00000000-0000-4000-8000-0000000000b1';
const TEMPLATE = '00000000-0000-4000-8000-0000000000a1';

function accountOf(id: string): Account {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role: 'user',
    disabled: false,
    createdAt: '2026-10-16T00:00:00.000Z',
  };
}
const owner = accountOf('owner');

const plan = {
  audience: 'Правление',
  goal: 'Решение о масштабировании',
  title: 'Итоги пилота',
  slides: Array.from({ length: 10 }, (_, index) => ({
    patternId: `p-${index}`,
    purpose: `Слайд ${index + 1}`,
    imageQuery: '',
    sourceEvidence: {},
  })),
};

let root: string;
let state: string;
let service: GenerationService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lct-retry-'));
  vi.stubEnv('RUNS_DIR', root);
  state = 'failed';
  const repository = {
    get: async (runId: string) => (runId === RUN ? { runId, state } : null),
  } as unknown as RunRepository;
  service = new GenerationService(
    repository,
    {} as ModelSettingsService,
    {} as ModelCapabilityService,
  );
  await mkdir(join(root, RUN), { recursive: true });
  await writeFile(
    join(root, RUN, 'metadata.json'),
    JSON.stringify({
      templateId: TEMPLATE,
      projectId: null,
      ownerId: owner.id,
      variant: 'dense',
      buildId: BUILD,
      updatedAt: 1,
    }),
  );
  await writeFile(
    join(root, RUN, 'request.json'),
    JSON.stringify({ templateId: TEMPLATE, brief: 'Итоги пилота чат-бота за квартал.' }),
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const started = { runId: 'run-new', variants: [], each: [], settled: Promise.resolve([]) };

describe('building a failed variant again', () => {
  it('starts that variant alone in its build, on the plan the build kept', async () => {
    await writeFile(join(root, RUN, 'composition-plan.json'), JSON.stringify(plan));
    const start = vi.spyOn(service, 'start').mockResolvedValue(started as unknown as StartedBuild);
    await service.retryVariant(RUN, owner);
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: TEMPLATE, brief: 'Итоги пилота чат-бота за квартал.' }),
      owner,
      { variant: 'dense', buildId: BUILD, plan },
    );
  });

  it('plans anew when the build failed before its plan was made', async () => {
    const start = vi.spyOn(service, 'start').mockResolvedValue(started as unknown as StartedBuild);
    await service.retryVariant(RUN, owner);
    expect(start.mock.calls[0]?.[2]).toEqual({ variant: 'dense', buildId: BUILD });
  });

  it('answers another account as if the run were missing', async () => {
    await expect(service.retryVariant(RUN, accountOf('stranger'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses a variant that did not fail', async () => {
    state = 'done';
    await expect(service.retryVariant(RUN, owner)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a build made before it kept its request', async () => {
    await rm(join(root, RUN, 'request.json'));
    await expect(service.retryVariant(RUN, owner)).rejects.toBeInstanceOf(ConflictException);
  });
});
