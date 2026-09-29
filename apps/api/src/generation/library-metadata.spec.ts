import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryMetadata, oneDeckPerBuild, type Metadata } from './library-metadata.js';
const id = 'run-11111111-1111-4111-8111-111111111111';
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'library-metadata-'));
  roots.push(root);
  await mkdir(join(root, id));
  await writeFile(
    join(root, id, 'metadata.json'),
    JSON.stringify({ templateId: 'template', projectId: 'project-a', updatedAt: 100 }),
  );
  return { root, store: new LibraryMetadata(root) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('persistent library metadata', () => {
  it('keeps deletion after reopening the store', async () => {
    const { root, store } = await setup();
    await store.remove(id);
    expect(await new LibraryMetadata(root).visible(id)).toBe(false);
    await expect(store.patch(id, { projectId: 'project-b' })).rejects.toThrow();
  });
  it('serializes patches without losing rename or project changes', async () => {
    const { root, store } = await setup();
    await Promise.all([
      store.patch(id, { title: 'Renamed' }),
      new LibraryMetadata(root).patch(id, { projectId: 'project-b' }),
    ]);
    expect(await store.read(id)).toMatchObject({
      title: 'Renamed',
      projectId: 'project-b',
      updatedAt: 100,
    });
  });
  it('rejects path traversal and makes repeated delete idempotent', async () => {
    const { store } = await setup();
    await expect(store.read('../outside')).rejects.toThrow();
    await store.remove(id);
    await store.remove(id);
    expect(await store.visible(id)).toBe(false);
  });
});

describe('builds of three variants', () => {
  const deck = (id: string, metadata: Partial<Metadata>) => ({
    id,
    metadata: { templateId: 't', projectId: null, updatedAt: 1, ...metadata },
  });
  const build = [
    deck('dense', { buildId: 'b', variant: 'dense' }),
    deck('balanced', { buildId: 'b', variant: 'balanced' }),
    deck('airy', { buildId: 'b', variant: 'airy' }),
  ];

  it('shows a build once, as the balanced variant until one is chosen', () => {
    expect(oneDeckPerBuild(build, new Set()).map((entry) => entry.id)).toEqual(['balanced']);
    expect(oneDeckPerBuild(build, new Set(['airy'])).map((entry) => entry.id)).toEqual(['airy']);
  });

  it('keeps decks made before builds were recorded apart', () => {
    const older = [deck('old-1', {}), deck('old-2', {})];
    expect(oneDeckPerBuild([...older, ...build], new Set()).map((entry) => entry.id)).toEqual([
      'old-1',
      'old-2',
      'balanced',
    ]);
  });

  it('finds the other variants of a deck, and none of another account', async () => {
    const { root, store } = await setup();
    const ids = [1, 2, 3].map((n) => `run-${String(n).repeat(8)}-0000-4000-8000-000000000000`);
    const owners = ['me', 'me', 'someone'];
    await Promise.all(
      ids.map(async (other, index) => {
        await mkdir(join(root, other));
        await writeFile(
          join(root, other, 'metadata.json'),
          JSON.stringify({
            templateId: 't',
            projectId: null,
            updatedAt: 1,
            buildId: 'b',
            ownerId: owners[index],
          }),
        );
      }),
    );
    expect((await store.build(ids[0] ?? '')).sort()).toEqual([ids[0], ids[1]].sort());
    expect(await store.build(id)).toEqual([id]);
  });
});
