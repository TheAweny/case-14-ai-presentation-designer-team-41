import { createStore, del, get, keys, set } from 'idb-keyval';
import type { SlideIr } from '@lct/contracts';
import {
  deckFingerprint,
  draftKey,
  mediaKey,
  mediaPrefix,
  readDraft,
  type DeckDraft,
} from './deck-draft';

/**
 * Где лежат черновики колод. В браузере — IndexedDB через `idb-keyval`, в тестах — `Map`.
 * Интерфейс узкий: ровно то, что нужно черновику.
 */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

/** Откуда черновик берёт файлы загруженных картинок и куда возвращает их после перезагрузки. */
export interface DraftMedia {
  file(mediaPart: string): Blob | null;
  restore(mediaPart: string, file: Blob): void;
}

export interface DraftStorage {
  /** Черновик колоды или null: его нет, он битый или от другой сборки колоды — тогда он стёрт. */
  load(deckId: string, base: string, media: DraftMedia): Promise<DeckDraft | null>;
  save(draft: DeckDraft, media: DraftMedia): Promise<void>;
  /** Забыть черновик колоды вместе с её картинками. */
  clear(deckId: string): Promise<void>;
}

export function createDraftStorage(store: KeyValueStore): DraftStorage {
  // Картинка не меняется под своим `mediaPart`: записанную один раз второй раз не пишем.
  const stored = new Set<string>();

  const clear = async (deckId: string) => {
    const prefix = mediaPrefix(deckId);
    const all = await store.keys();
    await Promise.all(all.filter((key) => key.startsWith(prefix)).map((key) => store.del(key)));
    await store.del(draftKey(deckId));
    for (const key of [...stored]) if (key.startsWith(prefix)) stored.delete(key);
  };

  return {
    async load(deckId, base, media) {
      const raw = await store.get(draftKey(deckId));
      if (raw === undefined) return null;
      const draft = readDraft(raw, { deckId, base });
      if (!draft) {
        await clear(deckId);
        return null;
      }
      for (const part of draft.media) {
        const key = mediaKey(deckId, part);
        const file = await store.get(key);
        if (!(file instanceof Blob)) continue;
        media.restore(part, file);
        stored.add(key);
      }
      return draft;
    },
    async save(draft, media) {
      for (const part of draft.media) {
        const key = mediaKey(draft.deckId, part);
        if (stored.has(key)) continue;
        const file = media.file(part);
        if (!file) continue;
        await store.set(key, file);
        stored.add(key);
      }
      await store.set(draftKey(draft.deckId), draft);
    },
    clear,
  };
}

/**
 * Слайды черновика колоды, если он относится к этой же сборке, иначе null. Экспорт из карточки
 * результата идёт по ним, а не по исходной колоде: удаление и перестановка объектов в редакторе
 * доезжают до файла. Черновика нет, он битый или от другой сборки — экспортируется исходная колода.
 */
export async function editedSlidesOf(
  store: KeyValueStore | null,
  deckId: string,
  origin: readonly SlideIr[],
): Promise<readonly SlideIr[] | null> {
  if (!store) return null;
  const raw = await store.get(draftKey(deckId));
  const draft = readDraft(raw, { deckId, base: deckFingerprint(origin) });
  return draft ? draft.slides : null;
}

/** База и таблица черновиков в IndexedDB. Имена — свои, чтобы не делить базу с кем-то ещё. */
const DATABASE = 'lct-editor';
const TABLE = 'drafts';

/** Хранилище браузера или null там, где IndexedDB нет (сервер, старый приватный режим). */
export function browserDraftStore(): KeyValueStore | null {
  if (typeof indexedDB === 'undefined') return null;
  const table = createStore(DATABASE, TABLE);
  return {
    get: (key) => get(key, table),
    set: (key, value) => set(key, value, table),
    del: (key) => del(key, table),
    keys: () => keys<string>(table),
  };
}
