import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentLibrarySource, samplesOf } from './persistent-library-source';
import { createDemoLibrary } from '../mocks/demo-library';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL('../../../../packages/contracts/fixtures/' + name + '.json', import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;
const deck = {
  runId: 'run-live',
  title: 'Live',
  designSystem: fixture('GenerationProfile').designSystem,
  templateIr: fixture('CompositionExportResponse').templateIr,
};
afterEach(() => vi.unstubAllGlobals());
describe('persistent library mutations', () => {
  it('publishes the real first-slide preview for a persisted deck', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).endsWith('/files/templates')
          ? Response.json([])
          : Response.json([{ deck, metadata: { projectId: null, templateId: 't', updatedAt: 1 } }]),
      ),
    );
    const [summary] = await createPersistentLibrarySource(createDemoLibrary().library).listDecks();
    expect(summary?.coverPreviewUrl).toBe('/api/backend/generation/run-live/artifacts/slide-1.png');
  });

  it('deletes through the API instead of the demo fallback', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const source = createPersistentLibrarySource(createDemoLibrary().library);
    await source.deleteDeck('run-live');
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/generation/run-live'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
  it('uses persisted project counts rather than a hardcoded zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        Response.json(
          String(url).endsWith('/library/projects')
            ? [
                {
                  projectId: 'p',
                  name: 'Project',
                  appearance: { icon: 'folder', color: 'blue' },
                  deckCount: 3,
                },
              ]
            : [],
        ),
      ),
    );
    expect(
      (await createPersistentLibrarySource(createDemoLibrary().library).listProjects())[0]
        ?.deckCount,
    ).toBe(3);
  });
  it('moves a real deck and reads its persisted project binding', async () => {
    const fetcher = vi.fn(async (url, init) =>
      Response.json(
        String(url).endsWith('/library/projects')
          ? [
              {
                projectId: 'p',
                name: 'Project',
                appearance: { icon: 'folder', color: 'blue' },
                deckCount: 1,
              },
            ]
          : String(url).endsWith('/files/templates')
            ? []
            : init?.method === 'PATCH'
              ? { ok: true }
              : [{ deck, metadata: { projectId: 'p', templateId: 't', updatedAt: 1 } }],
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const result = await createPersistentLibrarySource(createDemoLibrary().library).updateDeck(
      'run-live',
      {
        projectId: 'p',
      },
    );
    expect(result.projectId).toBe('p');
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/generation/run-live'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ projectId: 'p' }) }),
    );
  });
  it('renames a variant the library shows its build by another one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) =>
        init?.method === 'PATCH'
          ? Response.json({ ok: true })
          : Response.json([
              {
                deck,
                metadata: {
                  projectId: null,
                  templateId: 't',
                  updatedAt: 1,
                  variants: ['run-dense', 'run-live', 'run-airy'],
                },
              },
            ]),
      ),
    );
    const result = await createPersistentLibrarySource(createDemoLibrary().library).updateDeck(
      'run-dense',
      { title: 'Итоги' },
    );
    expect(result.deckId).toBe('run-live');
  });
});

describe('samples of a template', () => {
  const note = (patternId: string, extra: Record<string, unknown> = {}) => ({
    patternId,
    kind: 'cards',
    items: 3,
    useFor: 'three points',
    title: 'Три карточки',
    skip: false,
    special: false,
    ...extra,
  });
  const profile = (previews?: string[]) => ({
    generation: {
      compositions: [
        { patternId: 'p-cover', sourceIndex: 4 },
        { patternId: 'p-cards', sourceIndex: 9 },
        { patternId: 'p-guide', sourceIndex: 0 },
      ],
    },
    index: {
      notes: [
        note('p-cards'),
        note('p-cover', { kind: 'cover', title: 'С фото' }),
        note('p-guide', { kind: 'reference', skip: true }),
        { patternId: 'p-broken' },
      ],
    },
    ...(previews ? { previews } : {}),
  });

  it('lists the described sample slides in file order, with the pictures once they are drawn', () => {
    const samples = samplesOf('t-1', profile(['slide-01.png']));
    expect(samples?.map((sample) => [sample.slideIndex, sample.kind, sample.reference])).toEqual([
      [0, 'reference', true],
      [4, 'cover', false],
      [9, 'cards', false],
    ]);
    expect(samples?.[1]?.previewUrl).toBe('/api/backend/files/templates/t-1/previews/slide-5.png');
  });

  it('has no samples before the template is analysed, and no pictures before they are drawn', () => {
    expect(samplesOf('t-1', {})).toBeUndefined();
    expect(samplesOf('t-1', profile())?.every((sample) => !sample.previewUrl)).toBe(true);
  });
});
