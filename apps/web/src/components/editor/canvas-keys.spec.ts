import { describe, expect, it } from 'vitest';
import { canvasKeyCommand, type CanvasKeyEvent } from './canvas-keys';

const CANVAS = { formField: false, typing: false };
const TYPING = { formField: false, typing: true };
const FIELD = { formField: true, typing: true };

function key(code: string, extra: Partial<CanvasKeyEvent> = {}): CanvasKeyEvent {
  return { code, key: code, ...extra };
}

describe('canvasKeyCommand', () => {
  it('steps the zoom with Ctrl or Cmd and plus or minus', () => {
    expect(canvasKeyCommand(key('Equal', { ctrlKey: true }), CANVAS)).toBe('zoom-in');
    expect(canvasKeyCommand(key('Equal', { metaKey: true, shiftKey: true }), CANVAS)).toBe(
      'zoom-in',
    );
    expect(canvasKeyCommand(key('NumpadAdd', { ctrlKey: true }), CANVAS)).toBe('zoom-in');
    expect(canvasKeyCommand(key('Minus', { ctrlKey: true }), CANVAS)).toBe('zoom-out');
    expect(canvasKeyCommand(key('NumpadSubtract', { metaKey: true }), CANVAS)).toBe('zoom-out');
  });

  it('reads plus and minus by character where the layout moves them', () => {
    expect(canvasKeyCommand(key('BracketRight', { key: '+', ctrlKey: true }), CANVAS)).toBe(
      'zoom-in',
    );
    expect(canvasKeyCommand(key('Slash', { key: '-', ctrlKey: true }), CANVAS)).toBe('zoom-out');
  });

  it('shows the slide at its template size with Ctrl or Cmd and zero', () => {
    expect(canvasKeyCommand(key('Digit0', { ctrlKey: true }), CANVAS)).toBe('zoom-actual');
    expect(canvasKeyCommand(key('Numpad0', { metaKey: true }), CANVAS)).toBe('zoom-actual');
  });

  it('fits the slide with Shift+1 and the selection with Shift+2', () => {
    expect(canvasKeyCommand(key('Digit1', { key: '!', shiftKey: true }), CANVAS)).toBe('zoom-fit');
    expect(canvasKeyCommand(key('Digit2', { key: '"', shiftKey: true }), CANVAS)).toBe(
      'zoom-selection',
    );
  });

  it('keeps Shift+digit for the text being typed', () => {
    expect(canvasKeyCommand(key('Digit1', { shiftKey: true }), TYPING)).toBeNull();
    expect(canvasKeyCommand(key('Digit2', { shiftKey: true }), TYPING)).toBeNull();
  });

  it('zooms while typing on the slide but leaves form fields their own keys', () => {
    expect(canvasKeyCommand(key('Equal', { ctrlKey: true }), TYPING)).toBe('zoom-in');
    expect(canvasKeyCommand(key('Equal', { ctrlKey: true }), FIELD)).toBeNull();
    expect(canvasKeyCommand(key('Digit0', { ctrlKey: true }), FIELD)).toBeNull();
  });

  it('leaves other chords and plain digits alone', () => {
    expect(canvasKeyCommand(key('Digit1'), CANVAS)).toBeNull();
    expect(canvasKeyCommand(key('Digit1', { ctrlKey: true }), CANVAS)).toBeNull();
    expect(canvasKeyCommand(key('Digit3', { shiftKey: true }), CANVAS)).toBeNull();
    expect(canvasKeyCommand(key('Equal', { ctrlKey: true, altKey: true }), CANVAS)).toBeNull();
    expect(canvasKeyCommand(key('KeyZ', { ctrlKey: true }), CANVAS)).toBeNull();
  });
});
