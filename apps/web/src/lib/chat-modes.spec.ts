import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatUiMode,
  nextChatMode,
  rememberChatMode,
  selectChatMode,
  storedChatMode,
  subscribeChatMode,
} from './chat-modes';

describe('chat mode preferences', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('starts with plan approval and ignores invalid stored values', () => {
    expect(storedChatMode()).toBe('plan');
    expect(nextChatMode('chat')).toBe('plan');
    storage.set('lct.chatMode', 'invalid');
    storage.set('lct.planChatMode', 'invalid');
    expect(storedChatMode()).toBe('plan');
    expect(selectChatMode('plan', 'chat')).toBe('plan');
  });

  it('restores the existing auto preference as Plan, including migration through Chat', () => {
    storage.set('lct.chatMode', 'auto');
    expect(storedChatMode()).toBe('auto');
    expect(chatUiMode(storedChatMode())).toBe('plan');
    rememberChatMode('chat');
    expect(storedChatMode()).toBe('chat');
    expect(selectChatMode('plan', 'chat')).toBe('auto');
    expect(nextChatMode('chat')).toBe('auto');
  });

  it('remembers the loaded chat setting when leaving Plan, then remembers Auto off', () => {
    rememberChatMode('chat', 'auto');
    expect(nextChatMode('chat')).toBe('auto');
    rememberChatMode('plan', 'auto');
    rememberChatMode('chat', 'plan');
    expect(nextChatMode('chat')).toBe('plan');
  });

  it('cycles two visible modes and keeps the current Plan setting when reselected', () => {
    expect(nextChatMode('plan')).toBe('chat');
    expect(nextChatMode('auto')).toBe('chat');
    expect(selectChatMode('plan', 'auto')).toBe('auto');
    expect(selectChatMode('plan', 'plan')).toBe('plan');
    expect(selectChatMode('chat', 'auto')).toBe('chat');
  });

  it('notifies all mounted composers and unsubscribes cleanly', () => {
    const notify = vi.fn();
    const unsubscribe = subscribeChatMode(notify);
    rememberChatMode('auto');
    expect(notify).toHaveBeenCalledOnce();
    expect(storedChatMode()).toBe('auto');
    unsubscribe();
    rememberChatMode('plan');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('falls back to approval when storage is unavailable', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('Storage is unavailable');
      },
    });
    expect(storedChatMode()).toBe('plan');
    expect(nextChatMode('chat')).toBe('plan');
    expect(() => rememberChatMode('auto')).not.toThrow();
  });
});
