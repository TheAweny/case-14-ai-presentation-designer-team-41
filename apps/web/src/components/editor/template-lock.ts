import type { SlideElement, SlideIr } from '@lct/contracts';

/** Template decoration that states no lock of its own and carries no words of the slide. */
function needsLock(element: SlideElement): boolean {
  if (element.kind !== 'decor' || element.sourceShapeId === null || element.locked !== undefined) {
    return false;
  }
  // A box or an arrow with a few words in it is the slide's content, as in PowerPoint: its text
  // is edited in place, so it stays selectable.
  const words = element.paragraphs?.some((paragraph) =>
    paragraph.runs.some((run) => run.text.trim() !== ''),
  );
  return !words;
}

/**
 * Оформление шаблона приходит заблокированным, как фигуры макета в PowerPoint: подложку или
 * карточку не утащить случайно, и рамка выделения начинается поверх неё, а не хватает её.
 * Фигура с собственным текстом — содержимое слайда, её не блокируем. Снять блокировку — меню
 * холста или замок в панели. Явное `locked` из IR не трогаем.
 */
export function lockTemplateDecor(slides: readonly SlideIr[]): readonly SlideIr[] {
  return slides.map((slide) => {
    if (!slide.elements.some(needsLock)) return slide;
    return {
      ...slide,
      elements: slide.elements.map((element) =>
        needsLock(element) ? { ...element, locked: true } : element,
      ),
    };
  });
}
