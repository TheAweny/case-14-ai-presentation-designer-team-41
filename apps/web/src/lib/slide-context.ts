import type {
  ChatAttachment,
  DecorShape,
  ElementRole,
  SlideElement,
  SlideIr,
} from '@lct/contracts';
import { layerTree, pickedLayers } from '@lct/deck-ops';

/**
 * Объекты и слайды колоды как контекст агента — «вот это», как в Figma AI и Cursor. Человек
 * кладёт в поле ассистента ссылку на выделенное или на слайд целиком; с сообщением уходит
 * снимок: номер слайда и фрагменты SlideIR на момент отправки. Снимок лежит в сообщении
 * человека — настоящий агент на стороне TypeScript получит его без изменения интерфейса.
 *
 * Здесь только данные и чистые функции: подпись чипа, дедупликация, призрак выделения,
 * проверка устаревших ссылок и снимок. Язык подписи выбирает интерфейс — отсюда выходит
 * не строка, а то, о чём подпись.
 */

/** Сколько ссылок держит поле. Больше — старшая уходит: последнее действие человека важнее. */
export const MAX_CONTEXT_REFS = 8;

/** О чём ссылка — по роли и типу элемента из SlideIR, без знания о шаблоне. */
export type RefSubject =
  /** Слайд целиком. */
  | { readonly kind: 'slide' }
  /** Один объект: подпись по роли, иконка по типу. */
  | {
      readonly kind: 'element';
      readonly elementKind: SlideElement['kind'];
      readonly role: ElementRole;
      /** Фигура оформления без смысловой роли подписывается своей формой. */
      readonly shape?: DecorShape;
    }
  /** Одна группа целиком. */
  | { readonly kind: 'group' }
  /** Несколько объектов: группы считаются одним. */
  | { readonly kind: 'many'; readonly count: number };

/** Ссылка на объекты слайда в поле ассистента. Пустой `elementIds` — весь слайд. */
export interface SlideRef {
  readonly kind: 'slide-ref';
  readonly slideId: string;
  readonly elementIds: readonly string[];
  /** Что это было, когда ссылку взяли: так подписан и устаревший чип. */
  readonly subject: RefSubject;
  /** Номер слайда с единицы — тоже на момент, когда ссылку взяли. */
  readonly slideNumber: number;
}

/**
 * Что получит агент: снимок на момент отправки. Весь слайд — SlideIR целиком (фон, заметки,
 * все объекты); объекты — только их элементы.
 */
export type SlideContext =
  | { readonly scope: 'slide'; readonly slideNumber: number; readonly slide: SlideIr }
  | {
      readonly scope: 'elements';
      readonly slideNumber: number;
      readonly slideId: string;
      readonly elements: readonly SlideElement[];
    };

/** Ссылка в отправленном сообщении: подпись — на момент отправки, рядом снимок для агента. */
export interface SlideRefAttachment extends SlideRef {
  readonly context: SlideContext;
}

/** Состояние ссылки сейчас: живая (с тем, что от неё осталось) или устаревшая. */
export type ResolvedRef =
  | {
      readonly status: 'live';
      readonly slideNumber: number;
      readonly subject: RefSubject;
      /** Объекты, которые ещё есть на слайде; пусто — весь слайд. */
      readonly elementIds: readonly string[];
    }
  | { readonly status: 'stale'; readonly reason: 'slide-removed' | 'elements-removed' };

/** Упоминание для ответа агента: о чём и на каком слайде. */
export interface ContextMention {
  readonly subject: RefSubject;
  readonly slideNumber: number;
}

/** О чём набор объектов слайда. Пустой набор — весь слайд. */
export function refSubject(slide: SlideIr, elementIds: readonly string[]): RefSubject {
  if (elementIds.length === 0) return { kind: 'slide' };
  const picked = pickedLayers(layerTree(slide.elements), new Set(elementIds));
  const [only] = picked;
  if (picked.length === 1 && only) {
    if (only.node.kind === 'group') return { kind: 'group' };
    const { element } = only.node;
    return {
      kind: 'element',
      elementKind: element.kind,
      role: element.role,
      ...(element.kind === 'decor' && element.shape ? { shape: element.shape } : null),
    };
  }
  return { kind: 'many', count: Math.max(picked.length, 1) };
}

/** Ссылка на объекты открытого слайда; объектов нет на слайде — null. */
export function createSlideRef(
  slides: readonly SlideIr[],
  slideId: string,
  elementIds: readonly string[],
): SlideRef | null {
  const index = slides.findIndex((slide) => slide.slideId === slideId);
  const slide = slides[index];
  if (!slide) return null;
  const present = new Set(slide.elements.map((element) => element.elementId));
  // Порядок наложения, а не порядок выделения: тот же набор — та же ссылка.
  const ids = slide.elements
    .map((element) => element.elementId)
    .filter((id) => elementIds.includes(id) && present.has(id));
  if (elementIds.length > 0 && ids.length === 0) return null;
  return {
    kind: 'slide-ref',
    slideId,
    elementIds: ids,
    subject: refSubject(slide, ids),
    slideNumber: index + 1,
  };
}

/** Ключ ссылки: тот же слайд и тот же набор объектов — одна ссылка. */
export function refKey(ref: Pick<SlideRef, 'slideId' | 'elementIds'>): string {
  return [ref.slideId, ...[...ref.elementIds].sort()].join('\u0000');
}

/**
 * Положить ссылку в поле. Такая уже есть — ничего не меняется. Места нет — уходит самая
 * старая.
 */
export function addRef(
  refs: readonly SlideRef[],
  ref: SlideRef,
  limit: number = MAX_CONTEXT_REFS,
): readonly SlideRef[] {
  const key = refKey(ref);
  if (refs.some((item) => refKey(item) === key)) return refs;
  const next = [...refs, ref];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function removeRef(refs: readonly SlideRef[], key: string): readonly SlideRef[] {
  return refs.filter((item) => refKey(item) !== key);
}

/**
 * Что от ссылки осталось в колоде сейчас. Слайда нет — устарела; объектов не осталось ни
 * одного — устарела; часть удалили — живая, но только с оставшимися.
 */
export function resolveRef(
  slides: readonly SlideIr[],
  ref: Pick<SlideRef, 'slideId' | 'elementIds'>,
): ResolvedRef {
  const index = slides.findIndex((slide) => slide.slideId === ref.slideId);
  const slide = slides[index];
  if (!slide) return { status: 'stale', reason: 'slide-removed' };
  const wanted = new Set(ref.elementIds);
  const ids = slide.elements.map((element) => element.elementId).filter((id) => wanted.has(id));
  if (ref.elementIds.length > 0 && ids.length === 0) {
    return { status: 'stale', reason: 'elements-removed' };
  }
  return {
    status: 'live',
    slideNumber: index + 1,
    subject: refSubject(slide, ids),
    elementIds: ids,
  };
}

/**
 * Призрак — текущее выделение, которое поле предлагает как контекст, пока открыт ассистент.
 * Его нет, если ничего не выделено, если человек убрал его крестиком (`dismissedKey`) или если
 * то же самое уже закреплено.
 */
export function ghostRef(
  slides: readonly SlideIr[],
  slideId: string | undefined,
  selectedIds: readonly string[],
  pinned: readonly SlideRef[],
  dismissedKey: string | null,
): SlideRef | null {
  if (!slideId || selectedIds.length === 0) return null;
  const ref = createSlideRef(slides, slideId, selectedIds);
  if (!ref) return null;
  const key = refKey(ref);
  if (key === dismissedKey || pinned.some((item) => refKey(item) === key)) return null;
  return ref;
}

/**
 * Вложения сообщения: снимок каждой живой ссылки на момент отправки. Устаревшие не уходят,
 * повторы (закреплённое и тот же призрак) — один раз.
 */
export function contextAttachments(
  slides: readonly SlideIr[],
  refs: readonly SlideRef[],
): readonly SlideRefAttachment[] {
  const seen = new Set<string>();
  return refs.flatMap((ref): SlideRefAttachment[] => {
    const resolved = resolveRef(slides, ref);
    if (resolved.status === 'stale') return [];
    const key = refKey({ slideId: ref.slideId, elementIds: resolved.elementIds });
    if (seen.has(key)) return [];
    seen.add(key);
    const slide = slides[resolved.slideNumber - 1];
    if (!slide) return [];
    const ids = new Set(resolved.elementIds);
    const context: SlideContext =
      resolved.elementIds.length === 0
        ? { scope: 'slide', slideNumber: resolved.slideNumber, slide }
        : {
            scope: 'elements',
            slideNumber: resolved.slideNumber,
            slideId: slide.slideId,
            elements: slide.elements.filter((element) => ids.has(element.elementId)),
          };
    return [
      {
        kind: 'slide-ref',
        slideId: ref.slideId,
        elementIds: resolved.elementIds,
        subject: resolved.subject,
        slideNumber: resolved.slideNumber,
        context,
      },
    ];
  });
}

/** Что агент видит в сообщении — для его ответа, в порядке вложений. */
export function contextMentions(
  attachments: readonly { readonly kind: string }[],
): readonly ContextMention[] {
  return attachments.flatMap((attachment) =>
    isSlideRefAttachment(attachment)
      ? [{ subject: attachment.subject, slideNumber: attachment.slideNumber }]
      : [],
  );
}

function isSlideRefAttachment(value: { readonly kind: string }): value is SlideRefAttachment {
  return value.kind === 'slide-ref';
}

/** Текст объекта слайда, если он есть: абзацы через перевод строки. */
function elementText(element: SlideElement): string {
  if (element.kind !== 'text') return '';
  return element.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    .slice(0, 4000);
}

/**
 * Снимок ссылки для агента в чате: какие объекты и что на них написано. \`name\` — подпись чипа
 * на языке интерфейса: так вложение видно и в ленте.
 */
export function chatContextOf(
  deckId: string,
  attachment: SlideRefAttachment,
  name: string,
): Extract<ChatAttachment, { kind: 'slides' }> {
  const elements =
    attachment.context.scope === 'slide'
      ? attachment.context.slide.elements
      : attachment.context.elements;
  return {
    kind: 'slides',
    deckId,
    slideNumber: attachment.slideNumber,
    name: name.slice(0, 200),
    elements: elements.slice(0, 60).map((element) => ({
      elementId: element.elementId,
      kind: element.kind,
      role: element.role,
      text: elementText(element),
    })),
  };
}
