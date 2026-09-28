import { describe, expect, it } from 'vitest';
import type { AssistantThread, ThreadMessage } from './assistant-threads';
import {
  chatDeckId,
  chatDocumentOf,
  chatSaveOf,
  chatSummaryOf,
  savedMessages,
  threadOfChat,
} from './chat-records';
import type { GeneratedVariant } from './deck-generator';
import type { TemplateSummary } from './library-source';

const variant = (name: GeneratedVariant['variant']): GeneratedVariant =>
  ({ variant: name, deckId: `run-${name}`, title: `Колода ${name}` }) as GeneratedVariant;

const result: ThreadMessage = {
  kind: 'result',
  id: 'm3',
  result: {
    runId: 'run-balanced',
    variants: [variant('dense'), variant('balanced'), variant('airy')],
    reviews: null,
    recommended: 'balanced',
    templateSubstituted: false,
    elapsedMs: 1000,
  },
};

function thread(messages: ThreadMessage[], deckId: string | null = null): AssistantThread {
  return { threadId: 'chat-1', messages, deckId, projectId: 'p1' };
}

const brief: ThreadMessage = {
  kind: 'user',
  id: 'm1',
  text: '\nИтоги квартала\nдля совета директоров',
  attachments: [],
  meta: null,
};

describe('chat records', () => {
  it('names the chat after the recommended deck, and by the brief before there is one', () => {
    expect(chatSaveOf(thread([brief]), undefined, 'Новая').title).toBe('Итоги квартала');
    expect(chatSaveOf(thread([brief, result]), undefined, 'Новая').title).toBe('Колода balanced');
    expect(chatSaveOf(thread([]), undefined, 'Новая').title).toBe('Новая');
  });

  it('lists every variant as a deck of the chat and leads to the recommended one', () => {
    const save = chatSaveOf(thread([brief, result]), undefined, 'Новая');
    expect(save.deckIds).toEqual(['run-dense', 'run-balanced', 'run-airy']);
    expect(save.conversation.primaryDeckId).toBe('run-balanced');
    expect(chatDeckId(thread([brief, result], 'run-airy'))).toBe('run-airy');
    expect(chatDeckId(thread([brief]))).toBeNull();
  });

  it('keeps no template import progress and no full template parse', () => {
    const template = {
      templateId: 't1',
      fileName: 'Бренд.pptx',
      templateIr: { heavy: true },
    } as unknown as TemplateSummary;
    const messages = savedMessages([
      { kind: 'import', id: 'i', importId: 'x' },
      { kind: 'template', id: 't', template },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      kind: 'template',
      id: 't',
      template: { templateId: 't1', fileName: 'Бренд.pptx' },
    });
  });

  it('saves a chat started in the editor panel outside projects', () => {
    const panel = { ...thread([brief]), projectId: '' };
    expect(chatSaveOf(panel, undefined, 'Новая').projectId).toBeNull();
  });

  it('brings a saved chat back as the same conversation', () => {
    const save = chatSaveOf(thread([brief, result], 'run-dense'), undefined, 'Новая');
    const document = chatDocumentOf({
      chatId: 'chat-1',
      ...save,
      deckId: 'run-dense',
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T11:00:00.000Z',
    });
    if (!document) throw new Error('The saved chat was not read back.');
    expect(threadOfChat(document)).toEqual(thread([brief, result], 'run-dense'));
    expect(document.updatedAt).toBe(Date.parse('2026-09-29T11:00:00.000Z'));
  });

  it('refuses an answer that is not a chat', () => {
    expect(chatSummaryOf(null)).toBeNull();
    expect(chatSummaryOf({ title: 'no id' })).toBeNull();
  });
});
