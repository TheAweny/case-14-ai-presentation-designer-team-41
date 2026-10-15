import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, DeckOutline } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import type { Account } from '../accounts/account-rules.js';
import { runBuild, type ChatToolScope } from './chat-tools.js';

const user = (text: string): ChatMessage => ({
  role: 'user',
  id: crypto.randomUUID(),
  text,
  attachments: [],
  mode: 'plan',
  createdAt: Date.now(),
});
function build(messages: ChatMessage[], outline: DeckOutline | null = null) {
  const start = vi.fn(async (_input: { brief: string }) => {
    throw new Error('Captured build input');
  });
  const generation = {
    template: async () => ({ file_name: 'Template.pptx', profile: null }),
    prepare: async () => undefined,
    start,
  } as unknown as GenerationService;
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    messages: () => messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
  const context: ToolContext = {
    callId: 'call',
    signal: new AbortController().signal,
    show: () => 0,
    update: () => undefined,
  };
  return {
    start,
    result: runBuild(generation, scope, context, {
      templateId: crypto.randomUUID(),
      outline,
      brief: 'Модель: бюджет 3 млн',
      fileIds: [],
    }).catch((error: unknown) => error),
  };
}

describe('generation brief regressions', () => {
  it('preserves the newest correction after 50,000 characters of earlier requirements', async () => {
    const { start, result } = build([
      user('А'.repeat(51000)),
      user('Исправление: бюджет 9 млн, дата 20 ноября 2026'),
    ]);
    await result;
    expect(start).toHaveBeenCalledOnce();
    expect(
      start.mock.calls[0]?.[0].brief.includes('Исправление: бюджет 9 млн, дата 20 ноября 2026'),
    ).toBe(true);
  });

  it('includes the complete approved outline in the brief used for source checks', async () => {
    const approved: DeckOutline = {
      title: 'Пилот',
      audience: 'Инвесторы',
      goal: 'Одобрить',
      slides: Array.from({ length: 10 }, (_, index) => ({
        title: `Слайд ${index}`,
        points: ['Не превышать 9 млн рублей'],
        kind: 'statement',
      })),
    };
    const { start, result } = build([user('Подготовь пилот')], approved);
    await result;
    expect(start.mock.calls[0]?.[0].brief.includes('Не превышать 9 млн рублей')).toBe(true);
  });

  it('fails explicitly instead of silently dropping requirements beyond the generation budget', async () => {
    const { start, result } = build([
      user('А'.repeat(61000)),
      user('Последнее обязательное исправление'),
    ]);
    expect(await result).toBeInstanceOf(Error);
    expect(start).not.toHaveBeenCalled();
  });
});
