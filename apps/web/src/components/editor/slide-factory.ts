import type { LayoutVariantName, SlideIr } from '@lct/contracts';
import type { SlideLayout } from '@/lib/deck-source';

/**
 * Паттерн пустого слайда. Пустой слайд есть в любой колоде, даже если в шаблоне такого макета
 * нет: на нём нет ничего, кроме фона шаблона.
 */
export const BLANK_PATTERN_ID = 'blank';

/** Что новый слайд берёт у колоды, какой бы макет ни выбрали. */
export interface DeckFrame {
  readonly variant: LayoutVariantName;
  readonly slideCx: number;
  readonly slideCy: number;
}

/** Макет, на котором стоит слайд, или null: слайд пустой либо его паттерна среди макетов нет. */
export function layoutOf(slide: SlideIr, layouts: readonly SlideLayout[]): SlideLayout | null {
  return layouts.find((layout) => layout.slide.patternId === slide.patternId) ?? null;
}

/**
 * Новый слайд на макете шаблона: копия заготовки — оформление макета и пустые рамки на местах
 * плейсхолдеров. Без макета — пустой слайд. Текста-заглушки нет: пустая рамка честнее, чем
 * «Заголовок слайда», и аудит такие строки ищет. Идентификаторы объектов новые, чтобы правка
 * одного слайда не задевала другой.
 */
export function slideFromLayout(
  layout: SlideLayout | null,
  deck: DeckFrame,
  slideId: string,
  nextId: () => string = () => crypto.randomUUID(),
): SlideIr {
  if (!layout) {
    return {
      schemaVersion: 1,
      slideId,
      variant: deck.variant,
      index: 0,
      patternId: BLANK_PATTERN_ID,
      slideCx: deck.slideCx,
      slideCy: deck.slideCy,
      elements: [],
    };
  }
  const slide = structuredClone(layout.slide);
  // Заметки докладчика — про конкретный слайд, у заготовки их быть не должно.
  delete slide.notes;
  return {
    ...slide,
    slideId,
    variant: deck.variant,
    elements: slide.elements.map((element) => ({ ...element, elementId: nextId() })),
  };
}
