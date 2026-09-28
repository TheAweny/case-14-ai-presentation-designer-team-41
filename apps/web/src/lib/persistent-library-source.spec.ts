import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentLibrarySource } from './persistent-library-source';
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
});
