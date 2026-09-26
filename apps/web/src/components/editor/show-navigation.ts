import type { KeyLike } from './editor-keymap';

/**
 * Показ слайдов: куда ведут клавиши и щелчки. Чистые функции без React и DOM.
 *
 * Клавиши — как в PowerPoint и Google Slides: вперёд — →, ↓, PageDown, пробел, Enter и N,
 * назад — ←, ↑, PageUp, Backspace и P, Home и End — к первому и последнему, Esc — выход.
 * После последнего слайда — чёрный экран «Конец показа», как в PowerPoint: следующий шаг
 * с него закрывает показ.
 */

export type ShowAction = 'next' | 'previous' | 'first' | 'last' | 'exit' | 'ignore';

const ACTIONS: Readonly<Record<string, ShowAction>> = {
  ArrowRight: 'next',
  ArrowDown: 'next',
  PageDown: 'next',
  Space: 'next',
  Enter: 'next',
  NumpadEnter: 'next',
  KeyN: 'next',
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  PageUp: 'previous',
  Backspace: 'previous',
  KeyP: 'previous',
  Home: 'first',
  End: 'last',
  Escape: 'exit',
  // F5 во время показа браузер понял бы как «обновить страницу».
  F5: 'ignore',
};

/** Что значит клавиша в показе, или null — клавиша не его (Ctrl+…, Alt+Tab и прочее). */
export function showAction(event: KeyLike): ShowAction | null {
  if (event.code === 'F5') return 'ignore';
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return ACTIONS[event.code] ?? null;
}

/**
 * Следующее место показа: номер слайда, `count` — экран «Конец показа», или `'exit'`.
 * С экрана конца вперёд — выход, назад — последний слайд.
 */
export function showStep(
  position: number,
  action: Exclude<ShowAction, 'ignore'>,
  count: number,
): number | 'exit' {
  if (count <= 0) return 'exit';
  switch (action) {
    case 'exit':
      return 'exit';
    case 'next':
      return position >= count ? 'exit' : position + 1;
    case 'previous':
      return Math.max(0, Math.min(position, count) - 1);
    case 'first':
      return 0;
    case 'last':
      return count - 1;
  }
}

/** Слайд, который открыть в редакторе после показа: тот, на котором остановились. */
export function slideAfterShow(position: number, count: number): number {
  return Math.max(0, Math.min(position, count - 1));
}
