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

interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Где полосе можно стоять в слое холста: везде, кроме поля у того края, к которому прижата
 * рейка инструментов, — рейка лежит поверх холста, и полоса ушла бы под неё. Остальные поля
 * свободны: там полоса может встать над выделением у самого края листа.
 */
export function barArea(
  size: { readonly width: number; readonly height: number },
  padding: Insets,
  dockSide: string | null,
): { x: number; y: number; width: number; height: number } {
  const left = dockSide === 'left' ? padding.left : 0;
  const right = dockSide === 'right' ? padding.right : 0;
  const top = dockSide === 'top' ? padding.top : 0;
  const bottom = dockSide === 'bottom' ? padding.bottom : 0;
  return {
    x: left,
    y: top,
    width: Math.max(0, size.width - left - right),
    height: Math.max(0, size.height - top - bottom),
  };
}
