/** Команда вида холста с клавиатуры. */
export type CanvasKeyCommand =
  'zoom-in' | 'zoom-out' | 'zoom-actual' | 'zoom-fit' | 'zoom-selection';

/** Что клавиша знает о событии: код физической клавиши не зависит от раскладки. */
export interface CanvasKeyEvent {
  readonly code: string;
  readonly key?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

/** Где стоит фокус: в поле формы или в наборе текста на слайде. */
export interface CanvasKeyFocus {
  /** Поле формы (input, textarea, select): там Ctrl/Cmd+± — свои клавиши поля. */
  readonly formField: boolean;
  /** Любой ввод текста, включая набор на слайде: Shift+цифра печатает знак. */
  readonly typing: boolean;
}

/**
 * Клавиши зума, как в Figma: Ctrl/Cmd+= и Ctrl/Cmd+− — шаг, Ctrl/Cmd+0 — 100 %, Shift+1 —
 * вписать слайд, Shift+2 — к выделению. Ctrl-зум работает и во время набора на слайде: зум
 * страницы браузера в редакторе не нужен никогда.
 */
export function canvasKeyCommand(
  event: CanvasKeyEvent,
  focus: CanvasKeyFocus,
): CanvasKeyCommand | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (focus.formField) return null;
    switch (event.code) {
      case 'Equal':
      case 'NumpadAdd':
        return 'zoom-in';
      case 'Minus':
      case 'NumpadSubtract':
        return 'zoom-out';
      case 'Digit0':
      case 'Numpad0':
        return 'zoom-actual';
      default:
        // Раскладки, где «+» и «−» стоят не на своих местах.
        if (event.key === '+' || event.key === '=') return 'zoom-in';
        if (event.key === '-' || event.key === '_') return 'zoom-out';
        return null;
    }
  }
  if (!event.shiftKey || focus.typing) return null;
  if (event.code === 'Digit1') return 'zoom-fit';
  if (event.code === 'Digit2') return 'zoom-selection';
  return null;
}
