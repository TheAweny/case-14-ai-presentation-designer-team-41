import type { ModelMessage, ToolSpec } from './chat-model.js';

/** Logical serialized request bound, not a provider tokenizer or its advertised token window. */
export const CHAT_CONTEXT_BUDGET_CHARS = 90000;

export class ContextBudgetExceededError extends Error {
  constructor(
    readonly characters: number,
    readonly limit: number,
  ) {
    super(`Required chat context exceeds its budget (${characters}/${limit} characters).`);
    this.name = 'ContextBudgetExceededError';
  }
}

/** Keep the latest user turn intact; compact observations, then remove complete older turns. */
export function fitChatContext(
  messages: readonly ModelMessage[],
  tools: readonly ToolSpec[],
  maxCharacters = CHAT_CONTEXT_BUDGET_CHARS,
  reservedCharacters = 0,
): ModelMessage[] {
  if (
    !Number.isSafeInteger(maxCharacters) ||
    maxCharacters < 1 ||
    !Number.isSafeInteger(reservedCharacters) ||
    reservedCharacters < 0
  )
    throw new Error('Context budgets must be bounded positive integers.');
  let fitted = [...messages];
  const size = () => JSON.stringify({ messages: fitted, tools }).length + reservedCharacters;
  if (size() <= maxCharacters) return fitted;
  const latestTool = fitted.findLastIndex((message) => message.role === 'tool');
  for (let index = 0; index < latestTool && size() > maxCharacters; index++) {
    const message = fitted[index];
    if (message?.role !== 'tool') continue;
    const content = JSON.stringify({
      omitted:
        'An earlier observation exceeded the context budget. Read its source again if required.',
      originalCharacters: message.content.length,
    });
    if (content.length < message.content.length) fitted[index] = { ...message, content };
  }
  while (size() > maxCharacters) {
    const latestUser = fitted.findLastIndex((message) => message.role === 'user');
    const start = fitted.findIndex((message) => message.role !== 'system');
    if (start < 0 || latestUser <= start) break;
    const next = fitted.findIndex((message, index) => index > start && message.role === 'user');
    if (next < 0) break;
    fitted = [...fitted.slice(0, start), ...fitted.slice(next)];
  }
  if (size() > maxCharacters) throw new ContextBudgetExceededError(size(), maxCharacters);
  return fitted;
}
