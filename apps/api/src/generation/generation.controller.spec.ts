import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRepository } from '@lct/run-store';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import { GenerationController } from './generation.controller.js';

const RUN = 'run-00000000-0000-4000-8000-000000000001';

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

/** The controller against an engine that answers `deck-import` with `answer`, or fails. */
function withEngine(answer: unknown | null): GenerationController {
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    posted.push({ path, body: JSON.parse(String(init?.body ?? 'null')) });
    if (path === '/v1/deck-import' && answer !== null) return Response.json(answer);
    return new Response('not here', { status: 503 });
  });
  controller = new GenerationController(repository, {} as ModelSettingsService);
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
    JSON.stringify({ templateId: 't', projectId: null, updatedAt: 1, title: 'Для руководства' }),
  );
});

afterEach(async () => {
  await controller?.onApplicationShutdown();
  controller = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('GET /generation/:id/deck', () => {
  it('answers the slides the engine read from the finished file', async () => {
    const deck = (await withEngine(imported).deck(RUN)) as Record<string, unknown>;

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
    const deck = (await withEngine(null).deck(RUN)) as Record<string, unknown>;

    expect(deck).not.toHaveProperty('slides');
    expect(deck.runId).toBe(RUN);
  });

  it('answers without slides when the engine breaks the contract', async () => {
    const deck = (await withEngine({ schemaVersion: 1, slides: [{}] }).deck(RUN)) as Record<
      string,
      unknown
    >;

    expect(deck).not.toHaveProperty('slides');
  });
});

describe('GET /generation/:id/media/:name', () => {
  it('hands out a picture the import wrote by the file name of its part', async () => {
    await writeFile(join(root, RUN, 'media', 'image5.png'), 'png');
    await writeFile(join(root, RUN, 'media', 'image6.jpeg'), 'jpeg');
    const routes = withEngine(null);

    const png = await routes.media(RUN, 'image5.png');
    expect(png.getHeaders().type).toBe('image/png');
    expect((await routes.media(RUN, 'image6.jpeg')).getHeaders().type).toBe('image/jpeg');
  });

  it('refuses a name that is not a picture file', async () => {
    const routes = withEngine(null);

    await expect(routes.media(RUN, 'deck.pptx')).rejects.toThrow('Unknown media.');
    await expect(routes.media(RUN, '..%2Fdeck.json')).rejects.toThrow('Unknown media.');
  });
});

describe('GET /generation/:id/artifacts/:name', () => {
  it('finds a slide preview by its number, however pdftoppm padded it', async () => {
    await mkdir(join(root, RUN, 'previews'), { recursive: true });
    await writeFile(join(root, RUN, 'previews', 'slide-01.png'), 'first');
    const routes = withEngine(null);

    const cover = await routes.artifact(RUN, 'slide-1.png');
    expect(cover.getHeaders().type).toBe('image/png');
    await expect(routes.artifact(RUN, 'slide-2.png')).rejects.toThrow('Artifact not found.');
  });
});
