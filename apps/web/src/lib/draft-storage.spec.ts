import { describe, expect, it } from 'vitest';
import type { SlideIr } from '@lct/contracts';
import { DEMO_DECK } from '../mocks/demo-deck';
import { createDraft, deckFingerprint, draftKey, mediaKey } from './deck-draft';
import { createDraftStorage, type DraftMedia, type KeyValueStore } from './draft-storage';

/** IndexedDB в памяти: те же четыре операции. */
function memoryStore() {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  const store: KeyValueStore = {
    get: async (key) => data.get(key),
    set: async (key, value) => {
      writes.push(key);
      data.set(key, value);
    },
    del: async (key) => {
      data.delete(key);
    },
    keys: async () => [...data.keys()],
  };
  return { data, writes, store };
}

function memoryMedia(files: Readonly<Record<string, Blob>> = {}) {
  const restored = new Map<string, Blob>();
  const media: DraftMedia = {
    file: (part) => files[part] ?? null,
    restore: (part, file) => {
      restored.set(part, file);
    },
  };
  return { media, restored };
}

const base = deckFingerprint(DEMO_DECK.slides);

/** Демо-колода, где на первом слайде лежит загруженная картинка. */
function withUpload(part: string): SlideIr[] {
  const [first, ...rest] = DEMO_DECK.slides;
  if (!first) throw new Error('demo deck is empty');
  const image: SlideIr['elements'][number] = {
    kind: 'image',
    elementId: 'upload-image',
    role: 'image',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    mediaPart: part,
    fit: 'contain',
  };
  return [{ ...first, elements: [...first.elements, image] }, ...rest];
}

describe('draft storage', () => {
  it('сохраняет черновик и открывает его вместе с картинками', async () => {
    const { store } = memoryStore();
    const picture = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const draft = createDraft('demo', base, withUpload('upload/a.png'), 1);
    await createDraftStorage(store).save(draft, memoryMedia({ 'upload/a.png': picture }).media);

    const { media, restored } = memoryMedia();
    const loaded = await createDraftStorage(store).load('demo', base, media);
    expect(loaded?.slides).toEqual(draft.slides);
    expect(restored.get('upload/a.png')).toBe(picture);
  });

  it('пишет картинку один раз, а слайды — на каждое сохранение', async () => {
    const { store, writes } = memoryStore();
    const storage = createDraftStorage(store);
    const { media } = memoryMedia({ 'upload/a.png': new Blob([new Uint8Array([1])]) });
    const slides = withUpload('upload/a.png');
    await storage.save(createDraft('demo', base, slides, 1), media);
    await storage.save(createDraft('demo', base, slides, 2), media);
    expect(writes).toEqual([mediaKey('demo', 'upload/a.png'), draftKey('demo'), draftKey('demo')]);
  });

  it('стирает черновик другой сборки колоды и не открывает его', async () => {
    const { store, data } = memoryStore();
    const storage = createDraftStorage(store);
    await storage.save(createDraft('demo', base, DEMO_DECK.slides, 1), memoryMedia().media);
    await store.set(mediaKey('demo', 'upload/a.png'), new Blob([]));
    expect(await storage.load('demo', 'rebuilt', memoryMedia().media)).toBeNull();
    expect(data.size).toBe(0);
  });

  it('пропускает и стирает битую запись', async () => {
    const { store, data } = memoryStore();
    await store.set(draftKey('demo'), { version: 1, deckId: 'demo', base, slides: 'oops' });
    expect(await createDraftStorage(store).load('demo', base, memoryMedia().media)).toBeNull();
    expect(data.has(draftKey('demo'))).toBe(false);
  });

  it('без черновика ничего не открывает и ничего не трогает', async () => {
    const { store, data } = memoryStore();
    await store.set(draftKey('other'), 'kept');
    expect(await createDraftStorage(store).load('demo', base, memoryMedia().media)).toBeNull();
    expect(data.get(draftKey('other'))).toBe('kept');
  });

  it('забывает черновик вместе с картинками только своей колоды', async () => {
    const { store, data } = memoryStore();
    const storage = createDraftStorage(store);
    const { media } = memoryMedia({ 'upload/a.png': new Blob([new Uint8Array([1])]) });
    await storage.save(createDraft('demo', base, withUpload('upload/a.png'), 1), media);
    await store.set(draftKey('other'), 'kept');
    await store.set(mediaKey('other', 'upload/a.png'), 'kept');
    await storage.clear('demo');
    expect([...data.keys()].sort()).toEqual([draftKey('other'), mediaKey('other', 'upload/a.png')]);
    // После очистки картинка пишется снова: черновик начат заново.
    await storage.save(createDraft('demo', base, withUpload('upload/a.png'), 2), media);
    expect(data.has(mediaKey('demo', 'upload/a.png'))).toBe(true);
  });
});
