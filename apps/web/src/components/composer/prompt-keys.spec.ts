import { describe, expect, it } from 'vitest';
import { isSubmitKey, promptAction } from './prompt-keys';

describe('promptAction', () => {
  it('sends when there is input and nothing blocks it', () => {
    expect(promptAction({ hasInput: true })).toEqual({ action: 'send', disabled: false });
    expect(promptAction({ hasInput: false })).toEqual({ action: 'send', disabled: true });
    expect(promptAction({ hasInput: true, blocked: true })).toEqual({
      action: 'send',
      disabled: true,
    });
  });

  it('stops a running build only while the field is empty', () => {
    expect(promptAction({ hasInput: false, running: true })).toEqual({
      action: 'stop',
      disabled: false,
    });
    // Набранное пожелание не пропадает: кнопка снова отправляет, сборку сменит новая.
    expect(promptAction({ hasInput: true, running: true })).toEqual({
      action: 'send',
      disabled: false,
    });
  });

  it('spins and stays disabled while the request is on its way', () => {
    expect(promptAction({ hasInput: true, sending: true })).toEqual({
      action: 'sending',
      disabled: true,
    });
  });
});

describe('isSubmitKey', () => {
  const key = (over: Partial<Parameters<typeof isSubmitKey>[0]> = {}) => ({
    key: 'Enter',
    shiftKey: false,
    altKey: false,
    isComposing: false,
    ...over,
  });

  it('sends on Enter, including Ctrl/Cmd+Enter', () => {
    expect(isSubmitKey(key())).toBe(true);
  });

  it('keeps Shift+Enter and Alt+Enter as a new line', () => {
    expect(isSubmitKey(key({ shiftKey: true }))).toBe(false);
    expect(isSubmitKey(key({ altKey: true }))).toBe(false);
  });

  it('lets an IME confirm its text instead of sending', () => {
    expect(isSubmitKey(key({ isComposing: true }))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isSubmitKey(key({ key: 'a' }))).toBe(false);
  });
});
