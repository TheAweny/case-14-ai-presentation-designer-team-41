import { slideIrSchema, type SlideIr } from '@lct/contracts';
import { isUploadPart } from './media-registry';

/**
 * Черновик колоды в браузере: пока API сохранения нет, правки переживают перезагрузку и
 * закрытие вкладки. Хранятся слайды целиком, а не журнал правок: журнал держит патчи Immer
 * и ссылки на выделение, а слайды — ровно то, что нужно открыть заново.
 *
 * Чистые функции без IndexedDB и React: хранилище и таймер живут в `draft-storage.ts` и
 * `draft-autosave.ts`.
 */

/** Версия формата записи. Чужую версию черновик не читает, а забывает. */
export const DRAFT_VERSION = 1;

export interface DeckDraft {
  readonly version: typeof DRAFT_VERSION;
  readonly deckId: string;
  /**
   * Отпечаток колоды, от которой начаты правки. Источник отдал другую колоду (её собрали
   * заново) — черновик к ней не относится, и поверх новой колоды его не кладём.
   */
  readonly base: string;
  /** Когда записан, мс от эпохи. */
  readonly savedAt: number;
  readonly slides: readonly SlideIr[];
  /** Картинки, которые пользователь загрузил в этой вкладке: они лежат рядом, по `mediaKey`. */
  readonly media: readonly string[];
}

const DRAFT_PREFIX = 'draft:';
const MEDIA_PREFIX = 'media:';

/** Ключ черновика колоды. */
export function draftKey(deckId: string): string {
  return `${DRAFT_PREFIX}${deckId}`;
}

/** Начало ключей картинок колоды: по нему черновик убирает за собой всё сразу. */
export function mediaPrefix(deckId: string): string {
  return `${MEDIA_PREFIX}${deckId}:`;
}

/** Ключ одной загруженной картинки. Картинки пишутся отдельно, чтобы не переписывать их на каждую правку. */
export function mediaKey(deckId: string, mediaPart: string): string {
  return `${mediaPrefix(deckId)}${mediaPart}`;
}

/**
 * Отпечаток слайдов — FNV-1a по их JSON. Не криптография: только чтобы узнать, та же ли
 * колода пришла от источника.
 */
export function deckFingerprint(slides: readonly SlideIr[]): string {
  const text = JSON.stringify(slides);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** Одни и те же ли слайды по содержимому, а не по ссылке. */
export function sameSlides(a: readonly SlideIr[], b: readonly SlideIr[]): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Загруженные пользователем картинки, на которые ссылаются слайды, без повторов. */
export function uploadPartsOf(slides: readonly SlideIr[]): string[] {
  const parts = new Set<string>();
  for (const slide of slides) {
    for (const element of slide.elements) {
      if (element.kind === 'image' && isUploadPart(element.mediaPart)) parts.add(element.mediaPart);
    }
  }
  return [...parts];
}

export function createDraft(
  deckId: string,
  base: string,
  slides: readonly SlideIr[],
  savedAt: number,
): DeckDraft {
  return { version: DRAFT_VERSION, deckId, base, savedAt, slides, media: uploadPartsOf(slides) };
}

/**
 * Сколько ждать чтения черновика, прежде чем открыть колоду как есть. IndexedDB отвечает за
 * единицы миллисекунд; дольше — значит, база занята другой вкладкой или браузер тормозит, и
 * держать человека перед скелетоном дольше нельзя.
 */
export const DRAFT_READ_TIMEOUT_MS = 1500;

/**
 * Открыть ли прочитанный черновик вместо колоды. Нет — если черновика нет, он совпадает с
 * исходной колодой или человек уже начал править то, что открылось без него: его свежая
 * правка важнее вчерашнего черновика, а подмена колоды посреди жеста сорвала бы его.
 */
export function shouldRestoreDraft(
  draft: DeckDraft | null,
  origin: readonly SlideIr[],
  edited: readonly SlideIr[] | null,
): boolean {
  if (!draft || sameSlides(draft.slides, origin)) return false;
  return edited === null || sameSlides(edited, origin);
}

const slidesSchema = slideIrSchema.array().min(1);

/**
 * Черновик из хранилища, если он годится для этой колоды, иначе null. Запись могла
 * повредиться, остаться от старой версии редактора или от другой сборки колоды — такую
 * черновик молча пропускает: лучше открыть колоду как есть, чем сломанной.
 */
export function readDraft(
  raw: unknown,
  expected: { readonly deckId: string; readonly base: string },
): DeckDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Partial<Record<keyof DeckDraft, unknown>>;
  if (record.version !== DRAFT_VERSION) return null;
  if (record.deckId !== expected.deckId || record.base !== expected.base) return null;
  const slides = slidesSchema.safeParse(record.slides);
  if (!slides.success) return null;
  const savedAt = typeof record.savedAt === 'number' ? record.savedAt : 0;
  return createDraft(expected.deckId, expected.base, slides.data, savedAt);
}
