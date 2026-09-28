import type { AssistantThread, ThreadMessage } from './assistant-threads';
import type { ConversationSnapshot } from './deck-conversations';

/**
 * Чаты в API: разговор с ассистентом, сохранённый целиком. Вкладка сохраняет его по ходу
 * разговора и получает обратно после обновления страницы; боковая панель показывает список.
 *
 * Модуль без React и сети: что попадает в сохранение и как из него вернуть разговор, проверяют
 * тесты.
 */

/** Чат в списке: для боковой панели и страницы проекта. */
export interface ChatSummary {
  readonly chatId: string;
  readonly title: string;
  /** null — чат вне проектов. */
  readonly projectId: string | null;
  readonly templateId: string | null;
  /** Колоды, которые собрал чат: все варианты всех сборок. */
  readonly deckIds: readonly string[];
  /** Колода, которую ведёт чат (`chatDeckId`); null — ещё не собрана. */
  readonly deckId: string | null;
  /** Мс с эпохи. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Что агент помнит сверх сообщений: выбранную колоду и состояние разговора. */
export interface ChatConversation {
  readonly deckId: string | null;
  /** Колода, которую ведёт чат: для показа из истории без загрузки разговора. */
  readonly primaryDeckId?: string | null;
  readonly agent: ConversationSnapshot | null;
}

/** Чат целиком, как его отдаёт API. */
export interface ChatDocument extends ChatSummary {
  readonly messages: readonly ThreadMessage[];
  readonly conversation: ChatConversation | null;
}

/** Тело сохранения `PUT /chats/:id`. */
export interface ChatSave {
  readonly title: string;
  readonly projectId: string | null;
  readonly templateId: string | null;
  readonly deckIds: readonly string[];
  readonly messages: readonly ThreadMessage[];
  readonly conversation: ChatConversation;
}

/** Самое длинное название чата, которое примет API. */
export const CHAT_TITLE_MAX_LENGTH = 200;

/** Первая непустая строка первой реплики человека. */
export function workingTitle(thread: Pick<AssistantThread, 'messages'>): string | null {
  const first = thread.messages[0];
  if (first?.kind !== 'user') return null;
  return (
    first.text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? null
  );
}

/**
 * Название разговора: колода, которую агент собрал (название советованного варианта), а пока её
 * нет — первая строка брифа.
 */
export function conversationTitle(thread: Pick<AssistantThread, 'messages'>): string | null {
  const done = thread.messages.findLast((message) => message.kind === 'result');
  if (done?.kind === 'result') {
    const { variants, recommended } = done.result;
    const title = (variants.find((item) => item.variant === recommended) ?? variants[0])?.title;
    if (title) return title;
  }
  return workingTitle(thread);
}

/** Все колоды, которые собрал разговор: варианты каждого итога и выбранная колода. */
export function chatDeckIds(thread: Pick<AssistantThread, 'messages' | 'deckId'>): string[] {
  const ids = thread.messages.flatMap((message) =>
    message.kind === 'result' ? message.result.variants.map((variant) => variant.deckId) : [],
  );
  if (thread.deckId !== null) ids.push(thread.deckId);
  return [...new Set(ids)];
}

/**
 * Колода, которую ведёт чат: выбранный вариант, а до выбора — вариант, который агент советует в
 * последнем итоге. Итога нет — null.
 */
export function chatDeckId(thread: Pick<AssistantThread, 'messages' | 'deckId'>): string | null {
  if (thread.deckId !== null) return thread.deckId;
  const done = thread.messages.findLast((message) => message.kind === 'result');
  if (done?.kind !== 'result') return null;
  const { variants, recommended } = done.result;
  return (variants.find((item) => item.variant === recommended) ?? variants[0])?.deckId ?? null;
}

/**
 * Сообщения для сохранения. Ход разбора шаблона живёт только во вкладке — после обновления его
 * не показать, а итог разбора идёт следующим сообщением. У итога разбора не хранится полный
 * разбор шаблона: карточке хватает профиля и макетов, а весит разбор больше всего разговора.
 */
export function savedMessages(messages: readonly ThreadMessage[]): ThreadMessage[] {
  return messages.flatMap((message): ThreadMessage[] => {
    if (message.kind === 'import') return [];
    if (message.kind === 'template') {
      const { templateIr: _ir, ...template } = message.template;
      return [{ ...message, template }];
    }
    return [message];
  });
}

/** Сохранение разговора. `untitled` — название, пока в разговоре нет ни брифа, ни колоды. */
export function chatSaveOf(
  thread: AssistantThread,
  agent: ConversationSnapshot | undefined,
  untitled: string,
): ChatSave {
  const lastTemplate = thread.messages.findLast((message) => message.kind === 'template');
  const title = (conversationTitle(thread) ?? untitled).slice(0, CHAT_TITLE_MAX_LENGTH);
  return {
    title: title.trim() === '' ? untitled : title,
    // Разговор, начатый в панели редактора, проекта не знает: он приходит пустой строкой.
    projectId: thread.projectId || null,
    templateId:
      agent?.templateId ??
      (lastTemplate?.kind === 'template' ? lastTemplate.template.templateId : null),
    deckIds: chatDeckIds(thread),
    messages: savedMessages(thread.messages),
    conversation: {
      deckId: thread.deckId,
      primaryDeckId: chatDeckId(thread),
      agent: agent ?? null,
    },
  };
}

/** Разговор из сохранённого чата. */
export function threadOfChat(chat: ChatDocument): AssistantThread {
  return {
    threadId: chat.chatId,
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    deckId: chat.conversation?.deckId ?? null,
    projectId: chat.projectId,
  };
}

/** Чат из ответа API: даты — в мс. Незнакомая форма — null. */
export function chatSummaryOf(row: unknown): ChatSummary | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = row as Record<string, unknown>;
  if (typeof value.chatId !== 'string' || typeof value.title !== 'string') return null;
  return {
    chatId: value.chatId,
    title: value.title,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    templateId: typeof value.templateId === 'string' ? value.templateId : null,
    deckIds: Array.isArray(value.deckIds)
      ? value.deckIds.filter((id): id is string => typeof id === 'string')
      : [],
    deckId: typeof value.deckId === 'string' ? value.deckId : null,
    createdAt: Date.parse(String(value.createdAt)) || 0,
    updatedAt: Date.parse(String(value.updatedAt)) || 0,
  };
}

/** Чат целиком из ответа API или null. */
export function chatDocumentOf(row: unknown): ChatDocument | null {
  const summary = chatSummaryOf(row);
  if (!summary) return null;
  const value = row as Record<string, unknown>;
  const conversation =
    typeof value.conversation === 'object' && value.conversation !== null
      ? (value.conversation as ChatConversation)
      : null;
  return {
    ...summary,
    messages: Array.isArray(value.messages) ? (value.messages as ThreadMessage[]) : [],
    conversation,
  };
}
