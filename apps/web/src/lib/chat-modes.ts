import { CHAT_MODES, type ChatMode } from '@lct/contracts';

/** UI modes; auto is a setting of Plan, while the API keeps all three values. */
export const CHAT_UI_MODES = ['chat', 'plan'] as const;
export type ChatUiMode = (typeof CHAT_UI_MODES)[number];

const STORAGE_KEY = 'lct.chatMode';
const PLAN_STORAGE_KEY = 'lct.planChatMode';
const listeners = new Set<() => void>();

export function storedChatMode(): ChatMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CHAT_MODES.find((mode) => mode === value) ?? 'plan';
  } catch {
    return 'plan';
  }
}

function storedPlanMode(): 'plan' | 'auto' {
  try {
    const value = window.localStorage.getItem(PLAN_STORAGE_KEY);
    if (value === 'plan' || value === 'auto') return value;
    return storedChatMode() === 'auto' ? 'auto' : 'plan';
  } catch {
    return 'plan';
  }
}

export function chatUiMode(mode: ChatMode): ChatUiMode {
  return mode === 'chat' ? 'chat' : 'plan';
}

export function selectChatMode(next: ChatUiMode, current: ChatMode): ChatMode {
  if (next === 'chat') return 'chat';
  return current === 'chat' ? storedPlanMode() : current;
}

/** Shift+Tab alternates Chat and Plan, preserving Plan's Auto setting. */
export function nextChatMode(mode: ChatMode): ChatMode {
  return selectChatMode(mode === 'chat' ? 'plan' : 'chat', mode);
}

export function rememberChatMode(next: ChatMode, previous = storedChatMode()): void {
  try {
    const plan = next === 'chat' ? previous : next;
    if (plan !== 'chat') window.localStorage.setItem(PLAN_STORAGE_KEY, plan);
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Without storage the current chat still accepts the selected mode.
  }
  for (const listener of listeners) listener();
}

export function subscribeChatMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
