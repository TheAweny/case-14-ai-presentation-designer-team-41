import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, DeckOutline } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import type { Account } from '../accounts/account-rules.js';
import { runBuild, type ChatToolScope } from './chat-tools.js';
import { generationBrief } from './chat-brief.js';

const user = (text: string): ChatMessage => ({
  role: 'user',
  id: crypto.randomUUID(),
  text,
  attachments: [],
  mode: 'plan',
  createdAt: Date.now(),
});
function build(
  messages: ChatMessage[],
  outline: DeckOutline | null = null,
  outlineSource: 'user' | 'model' = 'user',
) {
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
      ...{ outlineSource },
      brief: 'Модель: бюджет 3 млн',
      fileIds: [],
    }).catch((error: unknown) => error),
  };
}

describe('generation brief regressions', () => {
  it('keeps previously approved claims when a new purpose supersedes the structure', () => {
    const approved: DeckOutline = {
      title: 'Пилот',
      audience: 'Директор',
      goal: 'Показать результат',
      slides: [
        { title: 'Ограничение', points: ['Бюджет не превышает 9 млн рублей'], kind: 'statement' },
      ],
    };
    const messages: ChatMessage[] = [
      user('Теперь нужно согласовать следующий пилот'),
      {
        role: 'assistant',
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        status: 'done',
        parts: [
          {
            type: 'plan',
            callId: 'approved',
            planId: crypto.randomUUID(),
            revision: 1,
            outline: approved,
            templateId: null,
            status: 'superseded',
            approvalSource: 'user',
          },
        ],
      },
    ];
    const brief = JSON.parse(generationBrief(messages, null, 'model', []));
    expect(brief.approvedOutline).toBeNull();
    expect(brief.priorApprovedPlans[0].outline.slides[0].points).toContain(
      'Бюджет не превышает 9 млн рублей',
    );
  });
  it('does not treat an automatic model outline as human-approved factual material', async () => {
    const automatic: DeckOutline = {
      title: 'Модель: бюджет 3 млн',
      audience: '',
      goal: '',
      slides: Array.from({ length: 10 }, () => ({
        title: 'Пилот',
        points: ['Модель: бюджет 3 млн'],
        kind: 'statement',
      })),
    };
    const { start, result } = build([user('Актуальный бюджет 9 млн')], automatic, 'model');
    await result;
    expect(start.mock.calls[0]?.[0].brief.includes('бюджет 3 млн')).toBe(false);
  });
  it('never promotes a model summary to factual source material', async () => {
    const { start, result } = build([user('Актуальный бюджет 9 млн')]);
    await result;
    expect(start.mock.calls[0]?.[0].brief.includes('бюджет 3 млн')).toBe(false);
  });

  it('asks for source requirements instead of building from model assertions alone', async () => {
    const { start, result } = build([]);
    expect(await result).toBeInstanceOf(Error);
    expect(start).not.toHaveBeenCalled();
  });
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
