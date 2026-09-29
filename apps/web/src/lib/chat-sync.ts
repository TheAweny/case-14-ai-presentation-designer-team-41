import type { AssistantThread, AssistantThreads } from './assistant-threads';
import { chatSaveOf, type ChatSave } from './chat-records';
import type { DeckConversations } from './deck-conversations';

/**
 * Сохранение разговоров вкладки в API. Разговор сохраняется целиком, когда перестал меняться на
 * `delayMs`: ход сборки меняет его часто, а сохранять каждую каплю незачем. Разговор, который
 * вернули из API, сохраняется, только когда в нём что-то изменится, — иначе чат поднимался бы в
 * истории от одного открытия.
 *
 * Модуль без React: сеть приходит снаружи (`save`), в тестах — подменой.
 */
export interface ChatSync {
  /** Разговор пришёл из API в таком виде: сохранять его, пока он не изменился, не нужно. */
  markSaved(thread: AssistantThread): void;
  /** Название чата, пока в нём нет ни брифа, ни колоды, — на языке интерфейса. */
  setUntitled(text: string): void;
  /** Сохранить всё, что ждёт, не дожидаясь паузы. */
  flush(): Promise<void>;
  dispose(): void;
}

export function createChatSync({
  threads,
  conversations,
  save,
  onSaved,
  delayMs = 800,
}: {
  threads: AssistantThreads;
  conversations: Pick<DeckConversations, 'snapshot'>;
  save: (chatId: string, chat: ChatSave) => Promise<void>;
  /** Сохранение дошло. `listChanged` — изменилось то, что видно в списке чатов. */
  onSaved?: (chatId: string, listChanged: boolean) => void;
  delayMs?: number;
}): ChatSync {
  let untitled = 'Новая презентация';
  /** Разговор в том виде, в каком он сохранён или сохраняется. */
  const saved = new Map<string, AssistantThread>();
  /** Что видно в списке чатов на момент последнего сохранения. */
  const listed = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const write = async (threadId: string) => {
    timers.delete(threadId);
    const thread = threads.get(threadId);
    if (!thread || thread.messages.length === 0) return;
    saved.set(threadId, thread);
    const chat = chatSaveOf(thread, conversations.snapshot(threadId), untitled);
    const visible = JSON.stringify([chat.title, chat.projectId, chat.deckIds]);
    try {
      await save(threadId, chat);
      const listChanged = listed.get(threadId) !== visible;
      listed.set(threadId, visible);
      onSaved?.(threadId, listChanged);
    } catch {
      // Не сохранилось — попробуем со следующим изменением разговора.
      saved.delete(threadId);
    }
  };

  const schedule = (threadId: string) => {
    const pending = timers.get(threadId);
    if (pending !== undefined) clearTimeout(pending);
    timers.set(
      threadId,
      setTimeout(() => void write(threadId), delayMs),
    );
  };

  const stop = threads.subscribe(() => {
    for (const thread of threads.list()) {
      if (thread.messages.length > 0 && saved.get(thread.threadId) !== thread) {
        schedule(thread.threadId);
      }
    }
  });

  return {
    markSaved(thread) {
      saved.set(thread.threadId, thread);
      const chat = chatSaveOf(thread, conversations.snapshot(thread.threadId), untitled);
      listed.set(thread.threadId, JSON.stringify([chat.title, chat.projectId, chat.deckIds]));
    },
    setUntitled(text) {
      untitled = text;
    },
    async flush() {
      const pending = [...timers.keys()];
      for (const threadId of pending) clearTimeout(timers.get(threadId));
      await Promise.all(pending.map((threadId) => write(threadId)));
    },
    dispose() {
      stop();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
