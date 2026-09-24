import type { SlideElement } from '@lct/contracts';
import { FONT_SIZE_PT } from '@lct/deck-ops';

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
 * Кегль после «−» или «+»: на целый пункт, как в Google Slides. Дробный кегль сначала встаёт
 * на ближайший целый в ту же сторону. Предел — тот же, что у правки кегля в журнале.
 */
export function stepFontSize(sizePt: number, direction: 1 | -1): number {
  const next = direction > 0 ? Math.floor(sizePt) + 1 : Math.ceil(sizePt) - 1;
  return Math.min(Math.max(next, FONT_SIZE_PT.min), FONT_SIZE_PT.max);
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

/**
 * Сочетания в подсказках полосы. `Mod` — Ctrl, на Mac — ⌘. Те же сочетания, что у клавиатуры
 * редактора и меню холста.
 */
export const BAR_SHORTCUTS = {
  bold: ['Mod', 'B'],
  italic: ['Mod', 'I'],
  underline: ['Mod', 'U'],
  duplicate: ['Mod', 'D'],
  front: ['Mod', 'Shift', ']'],
  forward: ['Mod', ']'],
  backward: ['Mod', '['],
  back: ['Mod', 'Shift', '['],
  lock: ['Mod', 'Shift', 'L'],
  remove: ['Del'],
  flipH: ['Mod', 'Shift', 'H'],
  flipV: ['Mod', 'Shift', 'V'],
  copy: ['Mod', 'C'],
  cut: ['Mod', 'X'],
  paste: ['Mod', 'V'],
} as const satisfies Record<string, readonly string[]>;

export type BarShortcut = keyof typeof BAR_SHORTCUTS;

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
