import { describe, expect, it, vi } from 'vitest';
import type { ModelMessage, ToolSpec } from './chat-model.js';
import { fitChatContext, ContextBudgetExceededError } from './context-budget.js';
import { AnswerWriter, runChatTurn } from './agent.js';

const tools: ToolSpec[] = [{ name: 'read', description: 'Read.', parameters: {} }];
const size = (messages: readonly ModelMessage[], specs = tools) =>
  JSON.stringify({ messages, tools: specs }).length;

describe('chat context budget', () => {
  it('counts tool arguments and removes complete older turns while preserving the latest correction', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'Trusted instructions.' },
      { role: 'user', content: 'Первый запрос.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'read', arguments: JSON.stringify({ text: 'x'.repeat(95000) }) },
        ],
      },
      { role: 'tool', callId: 'c1', content: 'Old result.' },
      { role: 'user', content: 'Исправление: бюджет 2027 года — 9 млн.' },
    ];
    const fitted = fitChatContext(messages, tools);
    expect(size(fitted)).toBeLessThanOrEqual(90000);
    expect(fitted).toEqual([messages[0], messages[4]]);
  });

  it('bounds user and assistant text, not only tool outputs', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'a'.repeat(60000) },
      { role: 'assistant', content: 'b'.repeat(60000) },
      { role: 'user', content: 'Последняя правка.' },
    ];
    const fitted = fitChatContext(messages, tools);
    expect(size(fitted)).toBeLessThanOrEqual(90000);
    expect(fitted.at(-1)?.content).toBe('Последняя правка.');
  });

  it('keeps the latest tool result intact and explicitly marks omitted earlier observations', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'System.' },
      { role: 'user', content: 'Задача.' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }] },
      { role: 'tool', callId: 'c1', content: 'a'.repeat(50000) },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'read', arguments: '{}' }] },
      { role: 'tool', callId: 'c2', content: 'b'.repeat(50000) },
    ];
    const fitted = fitChatContext(messages, tools);
    expect(size(fitted)).toBeLessThanOrEqual(90000);
    expect(fitted.at(-1)).toEqual(messages.at(-1));
    expect(JSON.parse(fitted[3]?.content ?? '{}')).toMatchObject({
      omitted: expect.any(String),
      originalCharacters: 50000,
    });
  });

  it('fails explicitly instead of truncating instructions or the latest user message', () => {
    expect(() =>
      fitChatContext(
        [
          { role: 'system', content: 'a'.repeat(50000) },
          { role: 'user', content: 'b'.repeat(50000) },
        ],
        [],
      ),
    ).toThrow(ContextBudgetExceededError);
  });

  it('includes tool descriptions and input schemas in the total budget', () => {
    expect(() =>
      fitChatContext(
        [
          { role: 'system', content: 'a'.repeat(50000) },
          { role: 'user', content: 'Latest.' },
        ],
        [{ name: 'read', description: 'b'.repeat(50000), parameters: {} }],
      ),
    ).toThrow(ContextBudgetExceededError);
  });

  it('does not contact the model when required context exceeds its budget', async () => {
    const step = vi.fn();
    const result = await runChatTurn({
      model: { model: 'fake', step },
      instructions: 'x'.repeat(95000),
      history: [{ role: 'user', content: 'Latest.' }],
      tools: [],
      specs: [],
      mode: 'chat',
      writer: new AnswerWriter('answer', () => undefined),
      signal: AbortSignal.timeout(5000),
    });
    expect(step).not.toHaveBeenCalled();
    expect(result).toMatchObject({ end: 'incomplete', reason: 'context_budget' });
  });
});
