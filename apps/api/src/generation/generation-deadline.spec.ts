import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRepository } from '@lct/run-store';
import type { Account } from '../accounts/account-rules.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import { currentTemplateIndexRevision, dependencyKey } from '@lct/pipeline';
import type { ChatToolActivity } from '@lct/contracts';
import { GenerationService, PROFILE_REVISION } from './generation.service.js';

const TEMPLATE = '00000000-0000-4000-8000-0000000000a1';
const CONTENT = '00000000-0000-4000-8000-0000000000c1';

const owner: Account = {
  id: 'owner',
  email: 'owner@example.com',
  name: 'owner',
  role: 'user',
  disabled: false,
  createdAt: '2026-10-16T00:00:00.000Z',
};

describe('preparation cancellation before the generation clock', () => {
  let root = '';
  let service: GenerationService | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await service?.onApplicationShutdown().catch(() => undefined);
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('keeps slow reads outside 290s, then cancels without creating runs or accepting late results', async () => {
    root = await mkdtemp(join(tmpdir(), 'lct-deadline-'));
    vi.stubEnv('RUNS_DIR', root);
    vi.stubEnv('IMAGE_BASE_URL', '');
    vi.stubEnv('IMAGE_MODEL', '');
    delete process.env.IMAGE_PROVIDER;
    const docx = join(root, 'notes.docx');
    await writeFile(docx, 'bytes');
    const profile = JSON.parse(
      await readFile(
        new URL('../../../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
        'utf8',
      ),
    ).valid[0].payload as unknown;

    const revision = await currentTemplateIndexRevision(
      fileURLToPath(new URL('../../../../registry/agents', import.meta.url)),
    );
    const typedProfile = profile as { templateHash: string; compositions: { patternId: string }[] };
    const index = {
      templateHash: typedProfile.templateHash,
      profileHash: dependencyKey(profile),
      revision,
      notes: typedProfile.compositions.map((p) => ({
        patternId: p.patternId,
        kind: 'other',
        items: 1,
        useFor: 'Test',
        skip: false,
      })),
    };
    let created = 0;
    let seenSignal: AbortSignal | undefined;
    let releaseExtract: (value: unknown) => void = () => undefined;
    const repository = {
      create: async () => {
        created += 1;
        return {
          runId: 'run-00000000-0000-4000-8000-0000000000f1',
          state: 'queued',
          createdAt: '',
          updatedAt: '',
          startedAt: null,
          completedAt: null,
        };
      },
      transition: async () => {
        throw new Error('transition should not be called');
      },
      appendEvent: async () => undefined,
      get: async () => null,
      events: async () => [],
      ping: async () => undefined,
      close: async () => undefined,
    } as unknown as RunRepository;

    service = new GenerationService(
      repository,
      {} as ModelSettingsService,
      {} as ModelCapabilityService,
    );
    vi.useFakeTimers();
    service.deadlineMs = 5_000;
    let enteredExtract!: () => void;
    const entered = new Promise<void>((resolve) => {
      enteredExtract = resolve;
    });
    const pool = service.pool;
    Object.assign(service, {
      pool: {
        query: async (sql: string) => {
          if (sql.includes("kind = 'template'")) {
            return {
              rows: [
                {
                  storage_path: join(root, 'template.pptx'),
                  file_name: 'template.pptx',
                  profile: { generation: profile, generationRevision: PROFILE_REVISION, index },
                },
              ],
            };
          }
          if (sql.includes("kind = 'content'")) {
            return { rows: [{ storage_path: docx, file_name: 'notes.docx' }] };
          }
          return { rows: [], rowCount: 0 };
        },
        end: () => pool.end(),
      },
      engine: {
        extractMaterial: (_request: unknown, signal?: AbortSignal) => {
          seenSignal = signal;
          enteredExtract();
          return new Promise((resolve) => {
            releaseExtract = resolve;
          });
        },
      },
    });

    const activities: ChatToolActivity[] = [];
    const pending = service.start(
      {
        requestId: '00000000-0000-4000-8000-0000000000b1',
        templateId: TEMPLATE,
        brief: 'Итоги пилота чат-бота за квартал.',
        slideCount: null,
        outline: null,
        projectId: null,
        contentIds: [CONTENT],
        seed: 42,
        model: null,
        thinking: null,
        reasoningEffort: null,
      },
      owner,
      undefined,
      (activity) => activities.push(activity),
    );
    await entered;
    expect(
      activities.some(
        (a) => a.status === 'running' && a.detail?.includes('Подготовка вне бюджета'),
      ),
    ).toBe(true);
    expect(seenSignal).toBeDefined();
    expect(seenSignal?.aborted).toBe(false);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(seenSignal?.aborted).toBe(false);
    expect(() =>
      service?.cancelPreparation('00000000-0000-4000-8000-0000000000b1', {
        ...owner,
        id: 'stranger',
      }),
    ).toThrow();
    service.cancelPreparation('00000000-0000-4000-8000-0000000000b1', owner);
    await rejected;
    expect(activities.at(-1)?.status).toBe('cancelled');
    expect(created).toBe(0);
    expect(seenSignal?.aborted).toBe(true);
    releaseExtract({
      schemaVersion: 1,
      segments: [],
      sourceSha256: 'a'.repeat(64),
      needsOcr: false,
      nextOffset: null,
    });
    await vi.advanceTimersByTimeAsync(30);
    expect(created).toBe(0);
    const names = await readdir(root);
    expect(names.filter((name) => name.startsWith('run-'))).toEqual([]);
  });
});
