import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunRepository, type RunRepository } from '@lct/run-store';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { GenerationController } from './generation.controller.js';
import { GenerationService, PROFILE_REVISION, type StoredTemplate } from './generation.service.js';
import type { Account } from '../accounts/account-rules.js';

const RUN = 'run-00000000-0000-4000-8000-000000000001';

function accountOf(id: string): Account {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role: 'user',
    disabled: false,
    createdAt: '2026-09-29T00:00:00.000Z',
  };
}
const owner = accountOf('owner');
const stranger = accountOf('stranger');

const imported = JSON.parse(
  await readFile(
    new URL('../../../../packages/contracts/fixtures/DeckImportResponse.json', import.meta.url),
    'utf8',
  ),
).valid[0].payload;

/** A repository where the one run is finished, which is all the deck routes ask of it. */
const repository = {
  get: async (runId: string) => (runId === RUN ? { runId, state: 'done' } : null),
} as unknown as RunRepository;

let root: string;
let posted: { path: string; body: unknown }[];
let controller: GenerationController | undefined;
let service: GenerationService | undefined;

function controllerOf(runs: RunRepository, models: ModelSettingsService): GenerationController {
  service = new GenerationService(runs, models, {
    reasoningOf: async () => ({ toggle: null, levels: false }),
  } as unknown as ModelCapabilityService);
  return new GenerationController(service);
}

/** The controller against an engine that answers `deck-import` with `answer`, or fails. */
function withEngine(answer: unknown | null): GenerationController {
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    posted.push({ path, body: JSON.parse(String(init?.body ?? 'null')) });
    if (path === '/v1/deck-import' && answer !== null) return Response.json(answer);
    return new Response('not here', { status: 503 });
  });
  controller = controllerOf(repository, {} as ModelSettingsService);
  return controller;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lct-generation-'));
  posted = [];
  vi.stubEnv('RUNS_DIR', root);
  vi.stubEnv('ENGINE_URL', 'http://engine:8000');
  await mkdir(join(root, RUN, 'media'), { recursive: true });
  await writeFile(
    join(root, RUN, 'deck.json'),
    JSON.stringify({ runId: RUN, title: 'Черновик', designSystem: {}, templateIr: {} }),
  );
  await writeFile(
    join(root, RUN, 'metadata.json'),
    JSON.stringify({
      templateId: 't',
      projectId: null,
      ownerId: owner.id,
      updatedAt: 1,
      title: 'Для руководства',
    }),
  );
});

afterEach(async () => {
  await service?.onApplicationShutdown();
  service = undefined;
  controller = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('GET /generation/:id/deck', () => {
  it('answers the slides the engine read from the finished file', async () => {
    const deck = (await withEngine(imported).deck(RUN, owner)) as Record<string, unknown>;

    expect(deck.slides).toEqual(imported.slides);
    expect(deck.title).toBe('Для руководства');
    // The engine reads the file and writes its pictures where the media route hands them out.
    expect(posted).toContainEqual({
      path: '/v1/deck-import',
      body: {
        schemaVersion: 1,
        pptxPath: join(root, RUN, 'deck.pptx'),
        mediaDir: join(root, RUN, 'media'),
      },
    });
  });

  it('answers without slides when the engine cannot read the file', async () => {
    const deck = (await withEngine(null).deck(RUN, owner)) as Record<string, unknown>;

    expect(deck).not.toHaveProperty('slides');
    expect(deck.runId).toBe(RUN);
  });

  it('answers without slides when the engine breaks the contract', async () => {
    const deck = (await withEngine({ schemaVersion: 1, slides: [{}] }).deck(RUN, owner)) as Record<
      string,
      unknown
    >;

    expect(deck).not.toHaveProperty('slides');
  });
});

describe('GET /generation/:id/summary', () => {
  it('returns the saved result without calling the engine even when it is unavailable', async () => {
    const deck = await withEngine(null).summary(RUN, owner);
    expect(deck).toEqual({
      runId: RUN,
      title: 'Для руководства',
      designSystem: {},
      templateIr: {},
    });
    expect(posted).toEqual([]);
  });

  it('does not expose the summary to another account', async () => {
    await expect(withEngine(null).summary(RUN, stranger)).rejects.toThrow(
      'Completed deck not found.',
    );
    expect(posted).toEqual([]);
  });
});

describe('GET /generation/:id/media/:name', () => {
  it('hands out a picture the import wrote by the file name of its part', async () => {
    await writeFile(join(root, RUN, 'media', 'image5.png'), 'png');
    await writeFile(join(root, RUN, 'media', 'image6.jpeg'), 'jpeg');
    const routes = withEngine(null);

    const png = await routes.media(RUN, 'image5.png', owner);
    expect(png.getHeaders().type).toBe('image/png');
    expect((await routes.media(RUN, 'image6.jpeg', owner)).getHeaders().type).toBe('image/jpeg');
  });

  it('refuses a name that is not a picture file', async () => {
    const routes = withEngine(null);

    await expect(routes.media(RUN, 'deck.pptx', owner)).rejects.toThrow('Unknown media.');
    await expect(routes.media(RUN, '..%2Fdeck.json', owner)).rejects.toThrow('Unknown media.');
  });
});

describe('GET /generation/:id/artifacts/:name', () => {
  it('finds a slide preview by its number, however pdftoppm padded it', async () => {
    await mkdir(join(root, RUN, 'previews'), { recursive: true });
    await writeFile(join(root, RUN, 'previews', 'slide-01.png'), 'first');
    const routes = withEngine(null);

    const cover = await routes.artifact(RUN, 'slide-1.png', owner);
    expect(cover.getHeaders().type).toBe('image/png');
    await expect(routes.artifact(RUN, 'slide-2.png', owner)).rejects.toThrow('Artifact not found.');
  });
});

describe('decks of other accounts', () => {
  it('answers another account as if the deck did not exist', async () => {
    const routes = withEngine(imported);

    await expect(routes.deck(RUN, stranger)).rejects.toThrow('Completed deck not found.');
    await expect(routes.artifact(RUN, 'deck.pptx', stranger)).rejects.toThrow(
      'Completed deck not found.',
    );
    await expect(routes.remove(RUN, stranger)).rejects.toThrow('Completed deck not found.');
  });

  it('answers the owner', async () => {
    const deck = (await withEngine(imported).deck(RUN, owner)) as Record<string, unknown>;

    expect(deck.runId).toBe(RUN);
  });
});

describe('runs cut short by a restart', () => {
  it('fails a run still going at start and leaves finished ones alone', async () => {
    const LIVE = 'run-00000000-0000-4000-8000-000000000002';
    const ids = [LIVE, RUN];
    const runs = new MemoryRunRepository(() => ids.shift() ?? 'run-unexpected');
    await mkdir(join(root, LIVE), { recursive: true });
    await runs.create();
    await runs.create();
    await runs.transition(LIVE, 'running');
    await runs.transition(RUN, 'running');
    await runs.transition(RUN, 'done');
    await runs.appendEvent(LIVE, {
      schemaVersion: 1,
      runId: LIVE,
      seq: 0,
      at: '2026-09-29T00:00:00.000Z',
      type: 'stage-started',
      stage: 'planning',
    });
    controller = controllerOf(runs, {} as ModelSettingsService);

    await service?.onApplicationBootstrap();

    expect((await runs.get(LIVE))?.state).toBe('failed');
    const failed = (await runs.events(LIVE)).at(-1);
    expect(failed).toMatchObject({ seq: 1, type: 'failed', stage: 'planning', retryable: true });
    expect((await runs.get(RUN))?.state).toBe('done');
    expect(await runs.events(RUN)).toEqual([]);
  });
});

const generationProfile = JSON.parse(
  await readFile(
    new URL('../../../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
).valid[0].payload;

describe('a prepared template', () => {
  const stored = (profile: StoredTemplate['profile']): StoredTemplate => ({
    storage_path: '/templates/t.pptx',
    file_name: 't.pptx',
    profile,
  });

  it('is one read by the current engine, and one read before is read again', () => {
    expect(
      GenerationService.prepared(
        stored({ generation: generationProfile, generationRevision: PROFILE_REVISION }),
      ),
    ).toBe(true);
    // Read before the engine found places for pictures: no revision stored.
    expect(GenerationService.prepared(stored({ generation: generationProfile }))).toBe(false);
    expect(GenerationService.prepared(stored({}))).toBe(false);
  });
});

describe('preparing a template', () => {
  const TEMPLATE = '00000000-0000-4000-8000-0000000000aa';

  it('reports the stage while it runs and what is stored once it is over', async () => {
    let answerProfile!: () => void;
    const profileAsked = new Promise<void>((asked) => {
      vi.stubGlobal('fetch', async (url: string | URL | Request) => {
        const path = new URL(String(url)).pathname;
        if (path !== '/v1/generation-profile') return new Response('not here', { status: 503 });
        asked();
        await new Promise<void>((answer) => (answerProfile = answer));
        return Response.json(generationProfile);
      });
    });
    const stored: { profile: Record<string, unknown> } = { profile: {} };
    controller = controllerOf(repository, {
      // No model is set up: the index is not made, which only leaves the planner without notes.
      resolveRole: async () => {
        throw new Error('No model.');
      },
    } as unknown as ModelSettingsService);
    (service as unknown as { pool: unknown }).pool = {
      query: async (sql: string) =>
        sql.startsWith('SELECT')
          ? { rows: [{ storage_path: '/t.pptx', ...stored }] }
          : { rows: [] },
      end: async () => undefined,
    };

    const prepared = controller.prepare({ templateId: TEMPLATE }, owner);
    await profileAsked;
    expect(await controller.preparation(TEMPLATE, owner)).toMatchObject({
      stage: 'profile',
      indexed: false,
      drawn: false,
    });

    answerProfile();
    await prepared;
    stored.profile = { previews: ['slide-1.png'] };
    expect(await controller.preparation(TEMPLATE, owner)).toEqual({
      stage: null,
      described: 0,
      total: 0,
      indexed: false,
      drawing: false,
      drawn: true,
    });
  });
});
