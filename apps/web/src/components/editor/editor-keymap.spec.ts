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

  it('leaves Alt chords, clipboard and unknown keys alone', () => {
    expect(editorCommand(key('KeyZ', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(editorCommand(key('KeyQ'))).toBeNull();
    expect(editorCommand(key('KeyC', { ctrlKey: true }))).toBeNull();
    // AltGr на Windows приходит как Ctrl+Alt: это ввод символа, а не команда.
    expect(editorCommand(key('KeyL', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('slides from the keyboard', () => {
  it('opens slide N with Ctrl/Cmd+1…9, top row or numpad, in any layout', () => {
    expect(editorCommand(key('Digit1', { key: '1', ctrlKey: true }))).toEqual({
      kind: 'go-to-slide',
      index: 0,
    });
    expect(editorCommand(key('Digit9', { metaKey: true }))).toEqual({
      kind: 'go-to-slide',
      index: 8,
    });
    expect(editorCommand(key('Numpad3', { ctrlKey: true }))).toEqual({
      kind: 'go-to-slide',
      index: 2,
    });
    // Ctrl+0 — зум холста, не слайд; Shift+1 — «вписать».
    expect(editorCommand(key('Digit0', { ctrlKey: true }))).toBeNull();
    expect(editorCommand(key('Digit1', { shiftKey: true }))).toBeNull();
  });

  it('pages with PageUp/PageDown and jumps with Home/End', () => {
    expect(editorCommand(key('PageUp'))).toEqual({ kind: 'step-slide', step: -1 });
    expect(editorCommand(key('PageDown'))).toEqual({ kind: 'step-slide', step: 1 });
    expect(editorCommand(key('Home'))).toEqual({ kind: 'go-to-slide', index: 0 });
    expect(editorCommand(key('End'))).toEqual({ kind: 'go-to-slide', index: 'last' });
    expect(editorCommand(key('PageDown', { shiftKey: true }))).toBeNull();
  });

  it('adds a slide with Ctrl+M or Ctrl+Enter and copies it with Ctrl+Shift+D', () => {
    expect(editorCommand(key('KeyM', { key: 'ь', ctrlKey: true }))).toEqual({ kind: 'new-slide' });
    expect(editorCommand(key('Enter', { metaKey: true }))).toEqual({ kind: 'new-slide' });
    expect(editorCommand(key('KeyD', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'duplicate-slide',
    });
  });
});

describe('objects from the keyboard', () => {
  it('walks objects with Tab and Shift+Tab', () => {
    expect(editorCommand(key('Tab'))).toEqual({ kind: 'select-step', step: 1 });
    expect(editorCommand(key('Tab', { shiftKey: true }))).toEqual({
      kind: 'select-step',
      step: -1,
    });
  });

  it('groups with Ctrl+G and ungroups with Ctrl+Shift+G, in any layout', () => {
    expect(editorCommand(key('KeyG', { key: 'п', ctrlKey: true }))).toEqual({ kind: 'group' });
    expect(editorCommand(key('KeyG', { metaKey: true, shiftKey: true }))).toEqual({
      kind: 'ungroup',
    });
    // Без модификатора G — инструмент рейки, а в наборе Ctrl+G не наш.
    expect(editorCommand(key('KeyG'))).toBeNull();
    expect(editorCommand(key('KeyG', { ctrlKey: true }), 'text')).toBeNull();
  });

  it('opens text or table editing with Enter', () => {
    expect(editorCommand(key('Enter'))).toEqual({ kind: 'edit' });
    expect(editorCommand(key('NumpadEnter'))).toEqual({ kind: 'edit' });
  });

  it('locks with Alt+Shift+L and flips with Shift+H / Shift+V', () => {
    expect(editorCommand(key('KeyL', { key: 'Д', altKey: true, shiftKey: true }))).toEqual({
      kind: 'lock',
    });
    expect(editorCommand(key('KeyH', { key: 'Р', shiftKey: true }))).toEqual({
      kind: 'flip',
      axis: 'horizontal',
    });
    expect(editorCommand(key('KeyV', { key: 'М', shiftKey: true }))).toEqual({
      kind: 'flip',
      axis: 'vertical',
    });
    // Без Shift это буквы инструментов рейки.
    expect(editorCommand(key('KeyH'))).toBeNull();
    expect(editorCommand(key('KeyV'))).toBeNull();
  });

  it('opens the cheat sheet with Ctrl+/ or ?', () => {
    expect(editorCommand(key('Slash', { ctrlKey: true }))).toEqual({ kind: 'shortcuts' });
    expect(editorCommand(key('Slash', { key: ',', shiftKey: true }))).toEqual({
      kind: 'shortcuts',
    });
  });
});

describe('text from the keyboard', () => {
  it('toggles bold, italic and underline by physical key, also in the Russian layout', () => {
    expect(editorCommand(key('KeyB', { key: 'и', ctrlKey: true }))).toEqual({
      kind: 'text-flag',
      flag: 'bold',
    });
    expect(editorCommand(key('KeyI', { key: 'ш', metaKey: true }))).toEqual({
      kind: 'text-flag',
      flag: 'italic',
    });
    expect(editorCommand(key('KeyU', { key: 'г', ctrlKey: true }))).toEqual({
      kind: 'text-flag',
      flag: 'underline',
    });
  });

  it('aligns paragraphs with Ctrl+Shift+L/E/R/J, as in Google Slides', () => {
    const align = (code: string) => editorCommand(key(code, { ctrlKey: true, shiftKey: true }));
    expect(align('KeyL')).toEqual({ kind: 'text-align', align: 'left' });
    expect(align('KeyE')).toEqual({ kind: 'text-align', align: 'center' });
    expect(align('KeyR')).toEqual({ kind: 'text-align', align: 'right' });
    expect(align('KeyJ')).toEqual({ kind: 'text-align', align: 'justify' });
  });

  it('steps the font size with Ctrl+Shift+> and Ctrl+Shift+<', () => {
    expect(editorCommand(key('Period', { key: 'Ю', ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'text-size',
      step: 1,
    });
    expect(editorCommand(key('Comma', { key: 'Б', ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'text-size',
      step: -1,
    });
  });

  it('in the open editor answers only to text keys', () => {
    const text = (code: string, extra: Partial<KeyLike> = {}) =>
      editorCommand(key(code, extra), 'text');
    expect(text('KeyB', { key: 'и', ctrlKey: true })).toEqual({ kind: 'text-flag', flag: 'bold' });
    expect(text('KeyE', { ctrlKey: true, shiftKey: true })).toEqual({
      kind: 'text-align',
      align: 'center',
    });
    expect(text('Escape')).toEqual({ kind: 'text-exit' });
    expect(text('Slash', { ctrlKey: true })).toEqual({ kind: 'shortcuts' });
    // Всё это в наборе — клавиши самого текста.
    expect(text('Slash', { shiftKey: true })).toBeNull();
    expect(text('Enter')).toBeNull();
    expect(text('Tab')).toBeNull();
    expect(text('Delete')).toBeNull();
    expect(text('KeyZ', { ctrlKey: true })).toBeNull();
    expect(text('Digit2', { ctrlKey: true })).toBeNull();
    expect(text('ArrowLeft')).toBeNull();
  });
});

describe('shortcutLabel', () => {
  it('uses symbols on a Mac and words elsewhere', () => {
    expect(shortcutLabel(['Mod', 'Shift', ']'], true)).toBe('⌘⇧]');
    expect(shortcutLabel(['Mod', 'D'], false)).toBe('Ctrl+D');
    expect(shortcutLabel(['Alt', 'Shift', 'L'], true)).toBe('⌥⇧L');
    expect(shortcutLabel(['Alt', 'Shift', 'L'], false)).toBe('Alt+Shift+L');
  });
});
