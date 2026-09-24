import type { ArrangeTarget } from '@lct/deck-ops';
import { arrowDirection, type ArrowDirection } from './slide-geometry';

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
  | { readonly kind: 'nudge'; readonly direction: ArrowDirection; readonly large: boolean };

export interface KeyLike {
  readonly code: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * Клавиша → команда. Раскладка по `code`, чтобы Ctrl+Z работал и в русской раскладке.
 * Ctrl и Cmd равноправны: на Mac это Cmd, на остальных — Ctrl.
 */
export function editorCommand(event: KeyLike): EditorCommand | null {
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey) return null;

  if (command) {
    switch (event.code) {
      case 'KeyZ':
        return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
      case 'KeyY':
        return event.shiftKey ? null : { kind: 'redo' };
      case 'KeyA':
        return event.shiftKey ? null : { kind: 'select-all' };
      case 'KeyD':
        return event.shiftKey ? null : { kind: 'duplicate' };
      case 'BracketRight':
        return { kind: 'arrange', to: event.shiftKey ? 'front' : 'forward' };
      case 'BracketLeft':
        return { kind: 'arrange', to: event.shiftKey ? 'back' : 'backward' };
      default:
        return null;
    }
  }

  if (event.key === 'Escape') return event.shiftKey ? null : { kind: 'deselect' };
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return event.shiftKey ? null : { kind: 'remove' };
  }
  const direction = arrowDirection(event.code);
  if (direction) return { kind: 'nudge', direction, large: event.shiftKey };
  return null;
}

/** Всё, что умеет холст: клавиатурные команды плюс буфер обмена из контекстного меню. */
export type CanvasCommand =
  | EditorCommand
  | { readonly kind: 'copy' }
  | { readonly kind: 'cut' }
  | { readonly kind: 'paste' }
  | { readonly kind: 'unlock-all' };

/** Подпись сочетания для меню: ⌘ на Mac, Ctrl на остальных. */
export function shortcutLabel(keys: readonly string[], mac: boolean): string {
  return keys
    .map((key) => {
      if (key === 'Mod') return mac ? '⌘' : 'Ctrl';
      if (key === 'Shift') return mac ? '⇧' : 'Shift';
      return key;
    })
    .join(mac ? '' : '+');
}
