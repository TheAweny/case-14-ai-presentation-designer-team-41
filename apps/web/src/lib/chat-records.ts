import {
  chatDocumentSchema,
  chatSummarySchema,
  type ChatMessage,
  type ChatMode,
  type ChatPart,
} from '@lct/contracts';

/**
 * Чаты в API. Разговор ведёт агент на сервере и там же его хранит; вкладка читает чат целиком и
 * получает ход ответа событиями (`chat-store.ts`). Боковая панель показывает список.
 *
 * Модуль без React и сети: как читать ответы API, проверяют тесты.
 */

/** Чат в списке: для боковой панели и страницы проекта. Даты — в мс. */
export interface ChatSummary {
  readonly chatId: string;
  readonly title: string;
  /** null — чат вне проектов. */
  readonly projectId: string | null;
  /** Колоды, которые собрал чат: все варианты всех сборок. */
  readonly deckIds: readonly string[];
  /** Колода, которую ведёт чат: выбранный вариант или совет агента; null — ещё не собрана. */
  readonly deckId: string | null;
  readonly mode: ChatMode;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Чат целиком, как его отдаёт API. */
export interface ChatDocument extends ChatSummary {
  readonly messages: readonly ChatMessage[];
  /** Агент отвечает прямо сейчас: к ходу можно подключиться. */
  readonly running: boolean;
}

/** Чат из ответа API или null, если форма незнакомая. */
export function chatSummaryOf(row: unknown): ChatSummary | null {
  const parsed = chatSummarySchema.safeParse(row);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    createdAt: Date.parse(parsed.data.createdAt) || 0,
    updatedAt: Date.parse(parsed.data.updatedAt) || 0,
  };
}

/** Чат целиком из ответа API или null. */
export function chatDocumentOf(row: unknown): ChatDocument | null {
  const parsed = chatDocumentSchema.safeParse(row);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    createdAt: Date.parse(parsed.data.createdAt) || 0,
    updatedAt: Date.parse(parsed.data.updatedAt) || 0,
  };
}

type Located<T extends ChatPart['type']> = {
  readonly messageId: string;
  readonly part: Extract<ChatPart, { type: T }>;
};

/** Части одного вида по всем ответам чата, по порядку. */
export function partsOf<T extends ChatPart['type']>(
  messages: readonly ChatMessage[],
  type: T,
): Located<T>[] {
  return messages.flatMap((message) =>
    message.role === 'assistant'
      ? message.parts.flatMap((part) =>
          part.type === type
            ? [{ messageId: message.id, part: part as Extract<ChatPart, { type: T }> }]
            : [],
        )
      : [],
  );
}

/** Вопрос агента, который ждёт ответа: на него отвечает и поле ввода. */
export function pendingQuestion(messages: readonly ChatMessage[]) {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return null;
  const question = last.parts.findLast((part) => part.type === 'question');
  return question?.type === 'question' && question.answer === null ? question : null;
}

/** Последний итог сборки в чате. */
export function latestResult(messages: readonly ChatMessage[]) {
  return partsOf(messages, 'result').at(-1)?.part ?? null;
}
