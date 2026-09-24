import type { SlideIr } from '@lct/contracts';

/**
 * Переключение слайдов: какой слайд открыт, куда ведут клавиши, как слайд назвать вслух.
 * Чистые функции без React и DOM — так их видно целиком и можно проверять в отрыве от разметки.
 */

/**
 * Параметр адреса с открытым слайдом. В нём id, а не номер: номер съезжает, когда слайды
 * переставляют, а ссылка должна вести на тот же слайд.
 */
export const SLIDE_PARAM = 'slide';

export type ListOrientation = 'vertical' | 'horizontal';

/** Индекс слайда по значению `?slide=`. Нет параметра или слайда с таким id — первый. */
export function slideIndexFromParam(
  slides: readonly Pick<SlideIr, 'slideId'>[],
  param: string | null,
): number {
  if (param === null) return 0;
  const index = slides.findIndex((slide) => slide.slideId === param);
  return index < 0 ? 0 : index;
}

/** Соседний слайд на `step` от текущего. У краёв колоды упирается, а не заворачивает. */
export function stepSlide(index: number, step: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index + step, 0), count - 1);
}

/**
 * Куда ведёт клавиша в списке слайдов, или null, если клавиша не его. ↑/↓ работают всегда,
 * ←/→ — только в горизонтальной ленте: в колонке они ничего не значат и остаются странице.
 */
export function listKeyTarget(
  key: string,
  index: number,
  count: number,
  orientation: ListOrientation,
): number | null {
  if (count <= 0) return null;
  const across = orientation === 'horizontal';
  switch (key) {
    case 'ArrowUp':
      return stepSlide(index, -1, count);
    case 'ArrowDown':
      return stepSlide(index, 1, count);
    case 'ArrowLeft':
      return across ? stepSlide(index, -1, count) : null;
    case 'ArrowRight':
      return across ? stepSlide(index, 1, count) : null;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Отрезок вдоль оси прокрутки: начало и длина, в координатах содержимого списка. */
export interface Span {
  readonly start: number;
  readonly size: number;
}

/**
 * Прокрутка, при которой элемент виден целиком вместе с полем `margin` вокруг, — ближайшая к
 * текущей, как `block: 'nearest'`: видимый элемент список не двигает. Элемент длиннее окна
 * встаёт началом к началу окна.
 */
export function nearestScroll(view: Span, item: Span, margin: number): number {
  const toStart = item.start - margin;
  const toEnd = item.start + item.size + margin - view.size;
  if (toStart < view.start || toEnd > toStart) return Math.max(toStart, 0);
  if (toEnd > view.start) return toEnd;
  return view.start;
}

/**
 * Tab и Shift+Tab на холсте, как в Figma и PowerPoint: следующий или предыдущий объект слайда
 * в порядке слоёв, по кругу. Шаг идёт от последнего выделенного; заблокированные пропускаются.
 * Выделения нет — Tab берёт первый объект, Shift+Tab последний.
 */
export function stepSelection(
  elements: readonly Pick<SlideIr['elements'][number], 'elementId' | 'locked'>[],
  selectedIds: readonly string[],
  step: -1 | 1,
): string[] {
  const free = elements.filter((element) => element.locked !== true);
  if (free.length === 0) return [];
  const at = free.findIndex((element) => element.elementId === selectedIds.at(-1));
  const start = at < 0 ? (step > 0 ? -1 : 0) : at;
  const next = free[(start + step + free.length) % free.length];
  return next ? [next.elementId] : [];
}

/**
 * Фокус в поле ввода или редактируемом элементе: там PageUp/PageDown и прочие клавиши
 * двигают курсор, и отбирать их у текста нельзя. Проверка по форме объекта, чтобы не зависеть от DOM.
 */
export function isTypingTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const { tagName, isContentEditable } = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  if (isContentEditable === true) return true;
  return typeof tagName === 'string' && /^(input|textarea|select)$/i.test(tagName);
}

/**
 * Заголовок слайда — текст первого непустого элемента с ролью `title`, или null. Роль даёт
 * вёрстка, а не шаблон: так слайд назван одинаково в любом шаблоне.
 */
export function slideTitle(slide: Pick<SlideIr, 'elements'>): string | null {
  for (const element of slide.elements) {
    if (element.kind !== 'text' || element.role !== 'title') continue;
    const text = element.paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') return text;
  }
  return null;
}
