import type { SlideElement } from '@lct/contracts';

/**
 * Что показывает полоса над выделением. Один объект — свои свойства по виду, как контекстные
 * тулбары Figma и Google Slides; несколько — выравнивание и распределение между собой.
 */
export type BarContext = 'text' | 'shape' | 'line' | 'image' | 'table' | 'chart' | 'multi';

export function barContext(selected: readonly SlideElement[]): BarContext | null {
  const [only, ...rest] = selected;
  if (!only) return null;
  if (rest.length > 0) return 'multi';
  switch (only.kind) {
    case 'text':
      return 'text';
    case 'decor':
      return only.shape === 'line' ? 'line' : 'shape';
    case 'image':
      return 'image';
    case 'table':
      return 'table';
    case 'chart':
      return 'chart';
  }
}

/**
 * Roving tabindex полосы: в неё попадают одним Tab, а между кнопками ходят стрелками, как в
 * тулбаре по WAI-ARIA. Стрелки идут по кругу, Home и End — к краям. Null — клавиша не наша.
 */
export function rovingIndex(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Стрелка из поля ввода уходит к соседней кнопке, только когда каретка уже у края текста:
 * иначе она двигает каретку, как в любом поле.
 */
export function leavesField(
  key: string,
  caret: { readonly start: number | null; readonly end: number | null; readonly length: number },
): boolean {
  if (caret.start === null || caret.start !== caret.end) return false;
  if (key === 'ArrowLeft') return caret.start === 0;
  if (key === 'ArrowRight') return caret.start === caret.length;
  return false;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Где полосе можно стоять в слое холста: везде, кроме полосы у того края, к которому прижата
 * рейка инструментов, — рейка лежит поверх холста, и полоса ушла бы под неё. `rail` — её
 * прямоугольник в пикселях слоя. Рейку, которую отпустили посреди холста, не обходим: иначе
 * от холста осталась бы щель.
 */
export function barArea(
  size: { readonly width: number; readonly height: number },
  rail: { readonly side: string; readonly box: Box } | null,
): Box {
  const inset = { left: 0, right: 0, top: 0, bottom: 0 };
  if (rail) {
    const { side, box } = rail;
    const edge = {
      left: box.x + box.width,
      right: size.width - box.x,
      top: box.y + box.height,
      bottom: size.height - box.y,
    };
    const span = side === 'left' || side === 'right' ? size.width : size.height;
    if (side in edge) {
      const value = edge[side as keyof typeof edge];
      if (value > 0 && value <= span / 3) inset[side as keyof typeof inset] = value;
    }
  }
  return {
    x: inset.left,
    y: inset.top,
    width: Math.max(0, size.width - inset.left - inset.right),
    height: Math.max(0, size.height - inset.top - inset.bottom),
  };
}
