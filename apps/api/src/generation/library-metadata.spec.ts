import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryMetadata } from './library-metadata.js';
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
