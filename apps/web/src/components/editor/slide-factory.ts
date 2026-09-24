import type { ElementRole, SlideElement, SlideIr } from '@lct/contracts';

/**
 * Оформление, которое новый слайд наследует от соседнего: подложки и украшения шаблона,
 * логотип, подвал. Номер слайда не переносится — он был бы чужим.
 */
const CHROME_ROLES: ReadonlySet<ElementRole> = new Set(['decoration', 'logo', 'footer']);

function isChrome(element: SlideElement): boolean {
  if (element.sourceShapeId === null) return false;
  return element.kind === 'decor' || CHROME_ROLES.has(element.role);
}

/**
 * Пустой слайд на макете соседнего: тот же размер, вариант и паттерн, только оформление
 * шаблона. Текста-заглушки нет: пустой слайд честнее, чем «Заголовок слайда», и аудит такие
 * строки ищет. Идентификаторы объектов новые, чтобы правка одного слайда не задевала другой.
 */
export function blankSlideFrom(
  base: SlideIr,
  slideId: string,
  nextId: () => string = () => crypto.randomUUID(),
): SlideIr {
  return {
    ...base,
    slideId,
    elements: base.elements
      .filter(isChrome)
      .map((element) => ({ ...structuredClone(element), elementId: nextId() })),
  };
}
