import type { ArrangeTarget } from '@lct/deck-ops';
import type { ParagraphAlign } from '@lct/contracts';
import { arrowDirection, type ArrowDirection } from './slide-geometry';
import { SHORTCUTS, type Chord, type ShortcutId, type ShortcutScope } from './editor-shortcuts';

export { shortcutLabel } from './editor-shortcuts';

/** Флаг начертания, который переключают Ctrl+B, Ctrl+I и Ctrl+U. */
export type TextFlag = 'bold' | 'italic' | 'underline';

/**
 * Команды холста с клавиатуры. Копировать, вырезать и вставить сюда не входят: их браузер
 * присылает событиями `copy`, `cut` и `paste` — только в них есть доступ к буферу обмена.
 */
export type EditorCommand =
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'remove' }
  | { readonly kind: 'select-all' }
  | { readonly kind: 'deselect' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'arrange'; readonly to: ArrangeTarget }
  | { readonly kind: 'nudge'; readonly direction: ArrowDirection; readonly large: boolean }
  // Слайды. Номер — с нуля; если слайдов меньше, открывается последний.
  | { readonly kind: 'go-to-slide'; readonly index: number | 'last' }
  | { readonly kind: 'step-slide'; readonly step: -1 | 1 }
  | { readonly kind: 'new-slide' }
  | { readonly kind: 'duplicate-slide' }
  // Объекты.
  | { readonly kind: 'select-step'; readonly step: -1 | 1 }
  | { readonly kind: 'edit' }
  | { readonly kind: 'lock' }
  | { readonly kind: 'flip'; readonly axis: 'horizontal' | 'vertical' }
  // Текст: в наборе — фрагмент, без набора — выделенные тексты целиком.
  | { readonly kind: 'text-flag'; readonly flag: TextFlag }
  | { readonly kind: 'text-align'; readonly align: ParagraphAlign }
  | { readonly kind: 'text-size'; readonly step: -1 | 1 }
  | { readonly kind: 'text-exit' }
  // Tab / Shift+Tab в наборе: уровень абзацев выделения.
  | { readonly kind: 'text-indent'; readonly step: -1 | 1 }
  | { readonly kind: 'shortcuts' };

export interface KeyLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** Номер слайда по цифре: `Digit3` и `Numpad3` → 2. */
function digitIndex(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match?.[1] ? Number(match[1]) - 1 : null;
}

/**
 * Что делает запись реестра. Каждой записи — своё решение: новая запись без него не
 * пройдёт проверку типов. `null` — клавиша не наша (буфер обмена, зум холста).
 */
function commandFor(id: ShortcutId, code: string): EditorCommand | null {
  switch (id) {
    case 'shortcuts':
      return { kind: 'shortcuts' };
    case 'undo':
      return { kind: 'undo' };
    case 'redo':
      return { kind: 'redo' };
    case 'slide-go': {
      const index = digitIndex(code);
      return index === null ? null : { kind: 'go-to-slide', index };
    }
    case 'slide-previous':
      return { kind: 'step-slide', step: -1 };
    case 'slide-next':
      return { kind: 'step-slide', step: 1 };
    case 'slide-first':
      return { kind: 'go-to-slide', index: 0 };
    case 'slide-last':
      return { kind: 'go-to-slide', index: 'last' };
    case 'slide-new':
      return { kind: 'new-slide' };
    case 'slide-duplicate':
      return { kind: 'duplicate-slide' };
    case 'select-all':
      return { kind: 'select-all' };
    case 'deselect':
      return { kind: 'deselect' };
    case 'select-next':
      return { kind: 'select-step', step: 1 };
    case 'select-previous':
      return { kind: 'select-step', step: -1 };
    case 'edit':
      return { kind: 'edit' };
    case 'duplicate':
      return { kind: 'duplicate' };
    case 'remove':
      return { kind: 'remove' };
    case 'nudge':
    case 'nudge-large': {
      const direction = arrowDirection(code);
      return direction ? { kind: 'nudge', direction, large: id === 'nudge-large' } : null;
    }
    case 'bring-forward':
      return { kind: 'arrange', to: 'forward' };
    case 'send-backward':
      return { kind: 'arrange', to: 'backward' };
    case 'bring-front':
      return { kind: 'arrange', to: 'front' };
    case 'send-back':
      return { kind: 'arrange', to: 'back' };
    case 'lock':
      return { kind: 'lock' };
    case 'flip-horizontal':
      return { kind: 'flip', axis: 'horizontal' };
    case 'flip-vertical':
      return { kind: 'flip', axis: 'vertical' };
    case 'bold':
    case 'italic':
    case 'underline':
      return { kind: 'text-flag', flag: id };
    case 'align-left':
      return { kind: 'text-align', align: 'left' };
    case 'align-center':
      return { kind: 'text-align', align: 'center' };
    case 'align-right':
      return { kind: 'text-align', align: 'right' };
    case 'align-justify':
      return { kind: 'text-align', align: 'justify' };
    case 'size-up':
      return { kind: 'text-size', step: 1 };
    case 'size-down':
      return { kind: 'text-size', step: -1 };
    case 'text-exit':
      return { kind: 'text-exit' };
    case 'indent':
      return { kind: 'text-indent', step: 1 };
    case 'outdent':
      return { kind: 'text-indent', step: -1 };
    case 'type-to-edit':
      return null;
    case 'copy':
    case 'cut':
    case 'paste':
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-actual':
    case 'zoom-fit':
    case 'zoom-selection':
    case 'pan':
      return null;
  }
}

/** Где сейчас клавиатура: на холсте или в открытом наборе текста. */
export type KeyContext = 'canvas' | 'text';

function inScope(scope: ShortcutScope, context: KeyContext): boolean {
  return scope === 'both' || scope === context;
}

/** Модификаторы нажаты ровно те, что у сочетания: Ctrl+Shift+Z — не Ctrl+Z. */
function matches(chord: Chord, event: KeyLike): boolean {
  return (
    chord.code === event.code &&
    (chord.mod === true) === (event.ctrlKey || event.metaKey) &&
    (chord.shift === true) === event.shiftKey &&
    (chord.alt === true) === event.altKey
  );
}

/**
 * Клавиша → команда по реестру `SHORTCUTS`. Раскладка по `code`, чтобы Ctrl+Z работал и в
 * русской раскладке. Ctrl и Cmd равноправны: на Mac это Cmd, на остальных — Ctrl.
 * В наборе текста (`context: 'text'`) отвечают только сочетания, которые там работают.
 */
export function editorCommand(
  event: KeyLike,
  context: KeyContext = 'canvas',
): EditorCommand | null {
  for (const spec of SHORTCUTS) {
    for (const chord of spec.chords) {
      if (!inScope(chord.scope ?? spec.scope, context) || !matches(chord, event)) continue;
      return commandFor(spec.id, event.code);
    }
  }
  return null;
}

/** Всё, что умеет холст: клавиатурные команды плюс буфер обмена из контекстного меню. */
export type CanvasCommand =
  | EditorCommand
  | { readonly kind: 'copy' }
  | { readonly kind: 'cut' }
  | { readonly kind: 'paste' }
  | { readonly kind: 'unlock-all' };
