import { describe, expect, it } from 'vitest';
import { editorCommand, shortcutLabel, type KeyLike } from './editor-keymap';

function key(code: string, extra: Partial<KeyLike> = {}): KeyLike {
  return {
    code,
    key: extra.key ?? code,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  };
}

describe('editorCommand', () => {
  it('reads undo and redo by physical key, with Ctrl or Cmd', () => {
    expect(editorCommand(key('KeyZ', { key: 'я', ctrlKey: true }))).toEqual({ kind: 'undo' });
    expect(editorCommand(key('KeyZ', { metaKey: true, shiftKey: true }))).toEqual({ kind: 'redo' });
    expect(editorCommand(key('KeyY', { ctrlKey: true }))).toEqual({ kind: 'redo' });
  });

  it('maps selection, duplicate and layer order', () => {
    expect(editorCommand(key('KeyA', { ctrlKey: true }))).toEqual({ kind: 'select-all' });
    expect(editorCommand(key('KeyD', { ctrlKey: true }))).toEqual({ kind: 'duplicate' });
    expect(editorCommand(key('BracketRight', { ctrlKey: true }))).toEqual({
      kind: 'arrange',
      to: 'forward',
    });
    expect(editorCommand(key('BracketLeft', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'arrange',
      to: 'back',
    });
  });

  it('maps Escape, Delete and Backspace without modifiers', () => {
    expect(editorCommand(key('Escape', { key: 'Escape' }))).toEqual({ kind: 'deselect' });
    expect(editorCommand(key('Delete', { key: 'Delete' }))).toEqual({ kind: 'remove' });
    expect(editorCommand(key('Backspace', { key: 'Backspace' }))).toEqual({ kind: 'remove' });
  });

  it('nudges with arrows and takes a large step with Shift', () => {
    expect(editorCommand(key('ArrowLeft'))).toEqual({
      kind: 'nudge',
      direction: 'left',
      large: false,
    });
    expect(editorCommand(key('ArrowDown', { shiftKey: true }))).toEqual({
      kind: 'nudge',
      direction: 'down',
      large: true,
    });
  });

  it('leaves Alt chords and unknown keys alone', () => {
    expect(editorCommand(key('KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(editorCommand(key('KeyQ'))).toBeNull();
    expect(editorCommand(key('KeyC', { ctrlKey: true }))).toBeNull();
  });
});

describe('shortcutLabel', () => {
  it('uses symbols on a Mac and words elsewhere', () => {
    expect(shortcutLabel(['Mod', 'Shift', ']'], true)).toBe('⌘⇧]');
    expect(shortcutLabel(['Mod', 'D'], false)).toBe('Ctrl+D');
  });
});
