import type { SlideIr } from '@lct/contracts';

/**
 * Оформление шаблона приходит заблокированным, как фигуры макета в PowerPoint: подложку или
 * карточку не утащить случайно, и рамка выделения начинается поверх неё, а не хватает её.
 * Снять блокировку — меню холста или замок в панели. Явное `locked` из IR не трогаем.
 */
export function lockTemplateDecor(slides: readonly SlideIr[]): readonly SlideIr[] {
  return slides.map((slide) => {
    const needs = slide.elements.some(
      (element) =>
        element.kind === 'decor' && element.sourceShapeId !== null && element.locked === undefined,
    );
    if (!needs) return slide;
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        element.kind === 'decor' && element.sourceShapeId !== null && element.locked === undefined
          ? { ...element, locked: true }
          : element,
      ),
    };
  });
}
