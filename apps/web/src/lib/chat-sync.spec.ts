import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantThreads } from './assistant-threads';
import type { ChatSave } from './chat-records';
import { createChatSync } from './chat-sync';

let ids = 0;
const newId = () => `id-${++ids}`;

beforeEach(() => {
  vi.useFakeTimers();
  ids = 0;
});
afterEach(() => vi.useRealTimers());

function setup() {
  const threads = createAssistantThreads(newId);
  const saves: { chatId: string; chat: ChatSave }[] = [];
  const listChanges: boolean[] = [];
  const sync = createChatSync({
    threads,
    conversations: { snapshot: () => undefined },
    save: async (chatId, chat) => {
      saves.push({ chatId, chat });
    },
    onSaved: (_chatId, listChanged) => listChanges.push(listChanged),
    delayMs: 100,
  });
  return { threads, sync, saves, listChanges };
}

const say = (text: string) => ({
  kind: 'user' as const,
  text,
  attachments: [],
  meta: null,
});

describe('chat sync', () => {
  it('saves a conversation once it stops changing', async () => {
    const { threads, saves } = setup();
    const chatId = threads.create(null);
    threads.append(chatId, say('Итоги квартала'));
    threads.append(chatId, { kind: 'agent', text: { key: 'building' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(saves).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.chatId).toBe(chatId);
    expect(saves[0]?.chat.messages).toHaveLength(2);
  });

  it('does not save an empty conversation', async () => {
    const { threads, saves } = setup();
    threads.create(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveLength(0);
  });

  it('does not save a chat brought back from the API until it changes', async () => {
    const { threads, sync, saves } = setup();
    const stored = {
      threadId: 'chat-9',
      messages: [{ ...say('Сохранённый'), id: 'm1' }],
      deckId: null,
      projectId: null,
    };
    sync.markSaved(stored);
    threads.hydrate(stored);
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveLength(0);

    threads.append('chat-9', say('Короче'));
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toHaveLength(1);
  });

  it('reports a change of the list only when the title, project or decks change', async () => {
    const { threads, listChanges } = setup();
    const chatId = threads.create(null);
    threads.append(chatId, say('Итоги'));
    await vi.advanceTimersByTimeAsync(200);
    threads.append(chatId, { kind: 'agent', text: { key: 'building' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(listChanges).toEqual([true, false]);
  });
});
