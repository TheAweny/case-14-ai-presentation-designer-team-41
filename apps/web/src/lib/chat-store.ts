import {
  chatPartSchema,
  type ChatAnswer,
  type ChatAttachment,
  type ChatMessage,
  type ChatMode,
  type ChatPart,
  type ChatTurnInput,
  type ChatTurnRequest,
  type DeckOutline,
  type LayoutVariant,
  type ModelRef,
} from '@lct/contracts';
import { chatDocumentOf, chatSummaryOf } from './chat-records';
import { applyChatEvent, readChatEvents } from './chat-stream';
import { canRetryChat, chatRetryDelay, ChatHttpError } from './chat-retry';
import { readReasoningEffort, readThinking } from './reasoning-effort';

export type ChatActivity =
  'idle' | 'uploading' | 'sending' | 'answering' | 'reconnecting' | 'stopping';
export interface ChatDraft {
  readonly text: string;
  readonly files: readonly File[];
  readonly templateFile: File | null;
  readonly brandbookFile?: File | null;
  readonly template?: ComposedMessage['template'];
  readonly context?: ComposedMessage['context'];
  readonly attachments?: readonly ChatAttachment[];
}
const EMPTY_DRAFT: ChatDraft = { text: '', files: [], templateFile: null, brandbookFile: null };

/** Вложение сообщения, пока оно едет на сервер: имя и вид, id ещё нет. */
export interface LocalAttachment {
  readonly kind: 'file' | 'template' | 'brandbook' | 'context';
  readonly name: string;
  readonly size?: number;
}

/**
 * Сообщение человека до того, как его принял сервер: файлы ещё загружаются или ход ещё не начат.
 * Сервер ответит сообщением с настоящим id, и это место займёт оно.
 */
export interface PendingTurn {
  readonly text: string;
  readonly attachments: readonly LocalAttachment[];
  /** Почему не ушло (может быть пустой строкой); null — ещё в пути. */
  readonly failed: string | null;
  readonly restorable?: boolean;
}

export interface ChatView {
  readonly chatId: string;
  readonly status: 'loading' | 'ready' | 'missing';
  readonly projectId: string | null;
  readonly title: string;
  /** Режим следующего хода. */
  readonly mode: ChatMode;
  /** Модель следующего хода; null — модель ассистента по умолчанию. */
  readonly model: ModelRef | null;
  readonly messages: readonly ChatMessage[];
  /** Агент отвечает: вкладка читает ход. */
  readonly running: boolean;
  readonly pending: PendingTurn | null;
  readonly activity: ChatActivity;
  readonly error: string | null;
  readonly recovery: 'retry' | 'reconnect' | 'cancel' | null;
  readonly selectionError?: boolean;
  readonly draft: ChatDraft;
  /** Колода, которую ведёт чат. */
  readonly deckId: string | null;
  /** Сколько токенов потратил ответ, который идёт сейчас; приходит, пока вкладка читает ход. */
  readonly usage?: TurnUsage;
}

export interface TurnUsage {
  readonly messageId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Что человек отправляет из поля: текст и файлы, шаблон файлом или из библиотеки. */
export interface ComposedMessage {
  readonly text: string;
  readonly files: readonly File[];
  readonly attachments?: readonly ChatAttachment[];
  readonly templateFile?: File | null;
  readonly brandbookFile?: File | null;
  readonly template?: { readonly templateId: string; readonly name: string } | null;
  /** Сколько слайдов человек обычно хочет — из его настроек; null — сколько нужно материалу. */
  readonly slideCount?: number | null;
  /** Объекты открытой колоды, на которые показал человек (панель редактора). */
  readonly context?: readonly Extract<ChatAttachment, { kind: 'slides' }>[];
}

/** С чем начинается чат: проект, режим, модель и колода редактора, если чат начат в нём. */
export interface ChatStart {
  readonly projectId: string | null;
  readonly mode: ChatMode;
  readonly model: ModelRef | null;
  readonly deckId?: string | null;
}

export interface ChatStoreDeps {
  /** Запрос к API через прокси вкладки. */
  readonly request: (path: string, init?: RequestInit) => Promise<Response>;
  readonly uploadContent: (file: File) => Promise<{ fileId: string; name: string; size: number }>;
  readonly uploadTemplate: (file: File) => Promise<{ templateId: string; name: string }>;
  readonly uploadBrandbook?: (file: File) => Promise<{ brandbookId: string; name: string }>;
  /** Ход закончился: списки чатов и колод на серверных страницах стоит обновить. */
  readonly onTurnEnd?: (chatId: string) => void;
  /** Replaceable clock for deterministic offline retry tests. */
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export interface ChatStore {
  get(chatId: string): ChatView | undefined;
  subscribe(listener: () => void): () => void;
  /** Прочитать чат из API, если его нет во вкладке; идущий ход досмотреть. */
  load(chatId: string): Promise<void>;
  /** Начать новый чат первым сообщением. Страница чата открывается сразу, не дожидаясь файлов. */
  start(chatId: string, chat: ChatStart, message: ComposedMessage): void;
  /**
   * Пустой чат во вкладке — в панели редактора, где чата у колоды ещё нет. На сервере он
   * появится с первым сообщением.
   */
  draft(chatId: string, chat: ChatStart): void;
  send(chatId: string, message: ComposedMessage): void;
  answer(chatId: string, questionId: string, answer: ChatAnswer): void;
  approve(
    chatId: string,
    planId: string,
    outline: DeckOutline,
    templateId: string,
    revision?: number,
  ): void;
  cancel(chatId: string): void;
  retry(chatId: string): void;
  restore(chatId: string): void;
  retryAnswer(chatId: string, messageId: string, model?: ModelRef | null): void;
  /**
   * Continue after a failed assistant turn with a new user message. Does not replay tools,
   * retry the previous answer, or approve a plan. The draft stays as the person left it.
   */
  continueAfterFailure(
    chatId: string,
    messageId: string,
    text: string,
    model?: ModelRef | null,
  ): void;
  editFailed(chatId: string, messageId: string): void;
  setDraft(chatId: string, draft: ChatDraft): void;
  setMode(chatId: string, mode: ChatMode): void;
  setModel(chatId: string, model: ModelRef | null): void;
  /** Выбрать вариант, к которому ведёт чат. */
  choose(chatId: string, deckId: string): void;
  /** Чат, в котором собрана колода, во вкладке; его id или null. */
  forDeck(deckId: string): Promise<string | null>;
  /**
   * Пересобрать вариант сборки, который не собрался, по её же плану. Итог сразу показывает
   * пересборку и сам обновится, когда она закончится. Отказ API — исключение с его причиной.
   */
  retryVariant(chatId: string, buildId: string, variant: LayoutVariant): Promise<void>;
}

/** Как часто вкладка спрашивает, пересобрался ли вариант. */
const REBUILD_POLL_MS = 4000;

/** Название нового чата — его первые слова, как их назовёт и сервер. */
function draftTitle(text: string, attachments: readonly LocalAttachment[]): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return (line || attachments[0]?.name || '').slice(0, 60);
}

/** A new answer is safe only when the failed turn performed no state-changing tools. */
export function canRetryAnswer(messages: readonly ChatMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === 'assistant' &&
    last.status === 'failed' &&
    messages.some((message) => message.role === 'user') &&
    last.parts.every(
      (part) =>
        part.type === 'text' ||
        part.type === 'error' ||
        (part.type === 'tool' &&
          [
            'list_templates',
            'describe_template',
            'read_file',
            'research_materials',
            'read_deck',
            'read_audit',
          ].includes(part.name)),
    )
  );
}

async function failureOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (Array.isArray(body.message)) return body.message.join(' ');
  } catch {
    // Ответ не JSON — остаётся код.
  }
  return `HTTP ${response.status}`;
}

export function createChatStore(deps: ChatStoreDeps): ChatStore {
  const chats = new Map<string, ChatView>();
  const listeners = new Set<() => void>();
  const loading = new Map<string, Promise<void>>();
  interface Operation {
    readonly request: ChatTurnRequest;
    readonly message?: ComposedMessage;
    readonly uploaded: Map<File, ChatAttachment>;
    submitted: boolean;
    accepted: boolean;
    stopped: boolean;
  }
  const operations = new Map<string, Operation>();
  const working = new Set<string>();
  const selections = new Map<string, Promise<void>>();
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const update = (chatId: string, patch: (chat: ChatView) => Partial<ChatView>) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, ...patch(chat) });
    notify();
  };

  const request = async (path: string, init?: RequestInit) => {
    const response = await deps.request(path, init);
    if (!response.ok)
      throw new ChatHttpError(
        await failureOf(response),
        response.status,
        response.headers.get('retry-after'),
      );
    return response;
  };
  const pathOf = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;
  const acceptedInput = (operation: Operation, messages: readonly ChatMessage[]) => {
    const input = operation.request.input;
    if (input.type === 'message')
      return messages.some((message) => message.id === operation.request.requestId);
    return messages.some(
      (message) =>
        message.role === 'assistant' &&
        message.parts.some((part) =>
          input.type === 'answer'
            ? part.type === 'question' &&
              part.questionId === input.questionId &&
              part.answer !== null
            : part.type === 'plan' && part.planId === input.planId && part.status === 'approved',
        ),
    );
  };
  const sync = async (chatId: string) => {
    const response = await request(pathOf(chatId));
    const document = chatDocumentOf(await response.json());
    if (!document) throw new Error('Invalid chat response.');
    const operation = operations.get(chatId);
    if (operation && acceptedInput(operation, document.messages)) operation.accepted = true;
    update(chatId, () => ({
      messages: document.messages,
      title: document.title,
      deckId: document.deckId,
      running: document.running,
      ...(operation?.accepted ? { pending: null } : {}),
    }));
    return document;
  };
  const recoverSnapshot = async (chatId: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sync(chatId);
      } catch (error) {
        if (!canRetryChat(error) || attempt >= 2) throw error;
        const delay = chatRetryDelay(attempt, error);
        if (delay > 10000) throw error;
        update(chatId, () => ({ activity: 'reconnecting' }));
        await wait(delay);
      }
    }
  };
  const finish = (chatId: string) => {
    operations.delete(chatId);
    update(chatId, () => ({
      running: false,
      activity: 'idle',
      pending: null,
      error: null,
      recovery: null,
    }));
    deps.onTurnEnd?.(chatId);
  };
  const fail = (chatId: string, error: unknown, recovery: ChatView['recovery']) => {
    const reason = error instanceof Error ? error.message : String(error);
    update(chatId, (chat) => ({
      activity: 'idle',
      error: reason,
      recovery,
      ...(recovery === 'retry' ? { running: false } : {}),
      pending: chat.pending
        ? { ...chat.pending, failed: reason, restorable: !operations.get(chatId)?.submitted }
        : null,
    }));
  };
  /** Recover by reading snapshots and attaching, never by replaying a mutation. */
  const follow = async (chatId: string, initial?: Response) => {
    let response = initial;
    let failures = 0;
    for (;;) {
      try {
        if (!response) {
          const document = await sync(chatId);
          if (!document.running) {
            finish(chatId);
            return;
          }
          response = await request(`${pathOf(chatId)}/stream`);
        }
        update(chatId, () => ({
          activity: operations.get(chatId)?.stopped ? 'stopping' : 'answering',
          running: true,
        }));
        if (!response.body) throw new TypeError('Missing chat stream.');
        await readChatEvents(response.body, (event) => {
          const operation = operations.get(chatId);
          if (operation && event.type === 'message' && event.message.role === 'user')
            operation.accepted = true;
          update(chatId, (chat) => ({
            messages: applyChatEvent(chat.messages, event),
            ...(event.type === 'message' && event.message.role === 'user' ? { pending: null } : {}),
            ...(event.type === 'usage'
              ? {
                  usage: {
                    messageId: event.messageId,
                    inputTokens: event.inputTokens,
                    outputTokens: event.outputTokens,
                  },
                }
              : {}),
          }));
        });
        finish(chatId);
        return;
      } catch (error) {
        response = undefined;
        if (error instanceof ChatHttpError && !canRetryChat(error)) throw error;
        if (failures >= 3) throw error;
        const delay = chatRetryDelay(failures++, error);
        if (delay > 10000) throw error;
        update(chatId, () => ({ activity: 'reconnecting' }));
        await wait(delay);
      }
    }
  };
  const attach = async (chatId: string) => {
    if (working.has(chatId)) return;
    working.add(chatId);
    try {
      await follow(chatId);
    } catch (error) {
      fail(chatId, error, 'reconnect');
    } finally {
      working.delete(chatId);
    }
  };
  const cancelRemote = async (chatId: string) => {
    await request(`${pathOf(chatId)}/cancel`, { method: 'POST' });
  };
  const post = async (chatId: string, operation: Operation) => {
    // Serialize once: model, mode, context and request id cannot change during retries.
    const body = JSON.stringify(operation.request);
    for (let attempt = 0; ; attempt++) {
      operation.submitted = true;
      try {
        const response = await request(`${pathOf(chatId)}/turns`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        operation.accepted = true;
        if (operation.stopped) await cancelRemote(chatId);
        await follow(chatId, response);
        return;
      } catch (error) {
        if (operation.accepted) throw error;
        // A definite refusal before a turn starts can safely be edited under a new id.
        if (error instanceof ChatHttpError && [400, 401, 403, 404, 413, 422].includes(error.status))
          operation.submitted = false;
        const retryable = canRetryChat(error);
        // A busy response or missing acknowledgement can mean our turn is already running.
        if (retryable || (error instanceof ChatHttpError && error.status === 409)) {
          try {
            const document = await recoverSnapshot(chatId);
            if (operation.accepted) {
              if (operation.stopped) await cancelRemote(chatId);
              await follow(chatId);
              return;
            }
            if (document.running) throw error;
          } catch (syncError) {
            if (!(syncError instanceof ChatHttpError && syncError.status === 404)) throw syncError;
          }
        }
        // Answer and approval retries require reconciliation and an explicit user action.
        if (
          !retryable ||
          operation.request.input.type !== 'message' ||
          attempt >= 2 ||
          operation.stopped
        )
          throw error;
        const delay = chatRetryDelay(attempt, error);
        if (delay > 10000) throw error;
        update(chatId, () => ({ activity: 'reconnecting' }));
        await wait(delay);
      }
    }
  };
  const execute = async (chatId: string, operation: Operation) => {
    if (working.has(chatId)) return;
    working.add(chatId);
    update(chatId, (chat) => ({
      running: true,
      error: null,
      recovery: null,
      pending: chat.pending ? { ...chat.pending, failed: null } : null,
    }));
    try {
      if (operation.submitted) {
        try {
          const document = await recoverSnapshot(chatId);
          if (operation.accepted) {
            await follow(chatId);
            return;
          }
          if (document.running) throw new ChatHttpError('The chat is answering already.', 409);
        } catch (error) {
          if (!(error instanceof ChatHttpError && error.status === 404)) throw error;
        }
      }
      const message = operation.message;
      if (message && operation.request.input.type === 'message') {
        update(chatId, () => ({ activity: 'uploading' }));
        const sent: ChatAttachment[] = [...(message.attachments ?? [])];
        if (message.templateFile) {
          let attachment = operation.uploaded.get(message.templateFile);
          if (!attachment) {
            const { templateId, name } = await deps.uploadTemplate(message.templateFile);
            attachment = { kind: 'template', templateId, name };
            operation.uploaded.set(message.templateFile, attachment);
          }
          sent.push(attachment);
        } else if (message.template) sent.push({ kind: 'template', ...message.template });
        if (message.brandbookFile) {
          let attachment = operation.uploaded.get(message.brandbookFile);
          if (!attachment) {
            if (!deps.uploadBrandbook) throw new Error('Brandbook upload is not configured.');
            const uploaded = await deps.uploadBrandbook(message.brandbookFile);
            attachment = { kind: 'brandbook', ...uploaded };
            operation.uploaded.set(message.brandbookFile, attachment);
          }
          sent.push(attachment);
        }
        for (const file of message.files) {
          if (operation.stopped) return;
          let attachment = operation.uploaded.get(file);
          if (!attachment) {
            const uploaded = await deps.uploadContent(file);
            attachment = { kind: 'file', ...uploaded };
            operation.uploaded.set(file, attachment);
          }
          sent.push(attachment);
        }
        if (operation.stopped) return;
        operation.request.input.attachments = [...sent, ...(message.context ?? [])];
      }
      if (operation.stopped) return;
      update(chatId, () => ({ activity: 'sending' }));
      await post(chatId, operation);
    } catch (error) {
      if (!operation.stopped || operation.submitted)
        fail(
          chatId,
          error,
          operation.stopped ? 'cancel' : operation.accepted ? 'reconnect' : 'retry',
        );
    } finally {
      if (!operations.has(chatId) || operations.get(chatId) === operation) working.delete(chatId);
    }
  };
  const begin = (
    chatId: string,
    input: ChatTurnInput,
    message?: ComposedMessage,
    mode?: ChatMode,
    model?: ModelRef | null,
  ) => {
    const chat = chats.get(chatId);
    if (!chat || chat.running || working.has(chatId) || operations.has(chatId)) return;
    const operation: Operation = {
      request: {
        requestId: crypto.randomUUID(),
        mode: mode ?? chat.mode,
        model: model !== undefined ? model : chat.model,
        reasoningEffort: readReasoningEffort(),
        thinking: readThinking(),
        projectId: chat.projectId,
        deckId: chat.deckId,
        slideCount: message?.slideCount ?? null,
        input,
      },
      message,
      uploaded: new Map(),
      submitted: false,
      accepted: false,
      stopped: false,
    };
    operations.set(chatId, operation);
    void execute(chatId, operation);
  };
  /** Keep original files until acknowledgement, and reuse completed uploads after a failure. */
  const deliver = (chatId: string, message: ComposedMessage) => {
    const chat = chats.get(chatId);
    if (!chat || chat.running || working.has(chatId) || operations.has(chatId)) return;
    const attachments: LocalAttachment[] = [
      ...(message.attachments ?? []).map((item) => ({
        kind: item.kind === 'slides' ? ('context' as const) : item.kind,
        name: item.name,
      })),
      ...(message.templateFile
        ? [
            {
              kind: 'template' as const,
              name: message.templateFile.name,
              size: message.templateFile.size,
            },
          ]
        : message.template
          ? [{ kind: 'template' as const, name: message.template.name, size: 0 }]
          : []),
      ...(message.brandbookFile
        ? [
            {
              kind: 'brandbook' as const,
              name: message.brandbookFile.name,
              size: message.brandbookFile.size,
            },
          ]
        : []),
      ...message.files.map((file) => ({ kind: 'file' as const, name: file.name, size: file.size })),
      ...(message.context ?? []).map((item) => ({ kind: 'context' as const, name: item.name })),
    ];
    update(chatId, () => ({
      pending: { text: message.text, attachments, failed: null },
      draft: EMPTY_DRAFT,
    }));
    begin(chatId, { type: 'message', text: message.text.trim(), attachments: [] }, message);
  };

  /** Ход без черновика: ответ на вопрос или одобрение плана. Сбой показывается ошибкой в ленте. */
  const act = (chatId: string, input: ChatTurnInput) => {
    begin(chatId, input);
  };

  const store: ChatStore = {
    get: (chatId) => chats.get(chatId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load(chatId) {
      if (chats.get(chatId)?.status === 'ready') return Promise.resolve();
      const pending = loading.get(chatId);
      if (pending) return pending;
      const work = (async () => {
        const response = await deps.request(`/chats/${encodeURIComponent(chatId)}`);
        const document = response.ok ? chatDocumentOf(await response.json()) : null;
        if (!document) {
          if (response.ok || response.status === 404 || response.status === 400) {
            chats.set(chatId, {
              chatId,
              status: 'missing',
              projectId: null,
              title: '',
              mode: 'plan',
              model: null,
              messages: [],
              running: false,
              pending: null,
              activity: 'idle',
              error: null,
              recovery: null,
              draft: EMPTY_DRAFT,
              deckId: null,
            });
            notify();
            return;
          }
          throw new Error(`Chat load failed (${response.status})`);
        }
        // Чат, начатый во вкладке, пока грузился, новее ответа.
        if (chats.get(chatId)?.status === 'ready') return;
        chats.set(chatId, {
          chatId,
          status: 'ready',
          projectId: document.projectId,
          title: document.title,
          mode: document.mode,
          model: document.model ?? null,
          messages: document.messages,
          running: document.running,
          pending: null,
          activity: 'idle',
          error: null,
          recovery: null,
          draft: EMPTY_DRAFT,
          deckId: document.deckId,
        });
        notify();
        // Страницу открыли посреди пересборки варианта — досматриваем её.
        for (const message of document.messages) {
          if (message.role !== 'assistant') continue;
          for (const part of message.parts) {
            if (part.type === 'result' && part.failed?.some((item) => item.status === 'retrying'))
              watchRebuild(chatId, part.buildId);
          }
        }
        if (document.running) await attach(chatId);
      })().finally(() => loading.delete(chatId));
      loading.set(chatId, work);
      return work;
    },
    start(chatId, chat, message) {
      store.draft(chatId, chat);
      update(chatId, () => ({
        title: draftTitle(
          message.text,
          message.files.map((file) => ({ kind: 'file' as const, name: file.name })),
        ),
      }));
      deliver(chatId, message);
    },
    draft(chatId, chat) {
      if (chats.has(chatId)) return;
      chats.set(chatId, {
        chatId,
        status: 'ready',
        projectId: chat.projectId,
        title: '',
        mode: chat.mode,
        model: chat.model,
        messages: [],
        running: false,
        pending: null,
        activity: 'idle',
        error: null,
        recovery: null,
        draft: EMPTY_DRAFT,
        deckId: chat.deckId ?? null,
      });
      notify();
    },
    send(chatId, message) {
      if (!chats.get(chatId)) return;
      deliver(chatId, message);
    },
    answer(chatId, questionId, answer) {
      act(chatId, { type: 'answer', questionId, answer });
    },
    approve(chatId, planId, outline, templateId, revision = 1) {
      act(chatId, { type: 'approve-plan', planId, outline, templateId, revision });
    },
    cancel(chatId) {
      const chat = chats.get(chatId);
      if (!chat || chat.activity === 'stopping') return;
      const operation = operations.get(chatId);
      if (operation) operation.stopped = true;
      if (operation && !operation.submitted) {
        // Upload APIs may finish later, but this operation can no longer start a turn.
        operations.delete(chatId);
        working.delete(chatId);
        const hasDraft =
          chat.draft.text ||
          chat.draft.files.length ||
          chat.draft.templateFile ||
          chat.draft.template ||
          chat.draft.attachments?.length ||
          chat.draft.context?.length;
        update(chatId, () => ({
          running: false,
          activity: 'idle',
          pending: null,
          error: null,
          recovery: null,
          draft:
            operation.message && !hasDraft
              ? {
                  text: operation.message.text,
                  files: operation.message.files,
                  templateFile: operation.message.templateFile ?? null,
                  template: operation.message.template,
                  context: operation.message.context,
                  attachments: operation.message.attachments,
                }
              : chat.draft,
        }));
        return;
      }
      update(chatId, () => ({ activity: 'stopping', error: null, recovery: null }));
      void cancelRemote(chatId).then(
        () => {
          if (
            operations.get(chatId) === operation &&
            chats.get(chatId)?.running &&
            !working.has(chatId)
          )
            void attach(chatId);
        },
        (error: unknown) => {
          if (operations.get(chatId) === operation && chats.get(chatId)?.running)
            fail(chatId, error, 'cancel');
        },
      );
    },
    retry(chatId) {
      const chat = chats.get(chatId);
      if (!chat) return;
      if (chat.recovery === 'cancel') {
        store.cancel(chatId);
        return;
      }
      if (working.has(chatId)) return;
      update(chatId, () => ({ error: null, recovery: null, activity: 'reconnecting' }));
      const operation = operations.get(chatId);
      if (operation && !operation.accepted) void execute(chatId, operation);
      else void attach(chatId);
    },
    restore(chatId) {
      const operation = operations.get(chatId);
      // An unacknowledged POST must first be reconciled; a new id could duplicate a mutation.
      if (!operation?.message || operation.submitted || working.has(chatId)) return;
      const chat = chats.get(chatId);
      if (
        !chat ||
        chat.draft.text ||
        chat.draft.files.length ||
        chat.draft.templateFile ||
        chat.draft.template ||
        chat.draft.attachments?.length ||
        chat.draft.context?.length
      )
        return;
      operations.delete(chatId);
      update(chatId, () => ({
        pending: null,
        error: null,
        recovery: null,
        draft: {
          text: operation.message?.text ?? '',
          files: operation.message?.files ?? [],
          templateFile: operation.message?.templateFile ?? null,
          template: operation.message?.template,
          context: operation.message?.context,
          attachments: operation.message?.attachments,
        },
      }));
    },
    editFailed(chatId, messageId) {
      const chat = chats.get(chatId);
      if (
        !chat ||
        chat.running ||
        chat.messages.at(-1)?.id !== messageId ||
        !canRetryAnswer(chat.messages)
      )
        return;
      if (
        chat.draft.text ||
        chat.draft.files.length ||
        chat.draft.templateFile ||
        chat.draft.template ||
        chat.draft.attachments?.length ||
        chat.draft.context?.length
      )
        return;
      const original = chat.messages.findLast((message) => message.role === 'user');
      if (original?.role !== 'user') return;
      const context = original.attachments.filter((item) => item.kind === 'slides');
      // Keep uploaded attachments as a pending input: editing must not discard them.
      update(chatId, () => ({
        draft: {
          text: original.text,
          files: [],
          templateFile: null,
          context,
          attachments: original.attachments.filter((item) => item.kind !== 'slides'),
        },
      }));
    },
    continueAfterFailure(chatId, messageId, text, model) {
      const chat = chats.get(chatId);
      if (!chat) return;
      const trimmed = text.trim();
      const last = chat.messages.at(-1);
      if (
        !trimmed ||
        chat.running ||
        chat.pending ||
        chat.recovery ||
        working.has(chatId) ||
        operations.has(chatId) ||
        last?.role !== 'assistant' ||
        last.id !== messageId ||
        last.status !== 'failed'
      )
        return;
      update(chatId, () => ({
        pending: { text: trimmed, attachments: [], failed: null },
      }));
      begin(
        chatId,
        { type: 'message', text: trimmed, attachments: [] },
        undefined,
        undefined,
        model,
      );
    },
    retryAnswer(chatId, messageId, model) {
      const chat = chats.get(chatId);
      if (!chat) return;
      const last = chat.messages.at(-1);
      if (
        chat.running ||
        chat.recovery ||
        working.has(chatId) ||
        last?.id !== messageId ||
        !canRetryAnswer(chat.messages)
      )
        return;
      if (model !== undefined) store.setModel(chatId, model);
      const original = chat.messages.findLast((message) => message.role === 'user');
      if (original?.role !== 'user') return;
      // Explicitly requested new answer. Unsafe tool executions are excluded above.
      begin(
        chatId,
        { type: 'message', text: original.text, attachments: original.attachments },
        undefined,
        original.mode,
      );
    },
    setDraft(chatId, draft) {
      update(chatId, () => ({ draft }));
    },
    setMode(chatId, mode) {
      update(chatId, () => ({ mode }));
    },
    setModel(chatId, model) {
      update(chatId, () => ({ model }));
      // Serialize writes so rapid picks cannot persist in reverse order.
      update(chatId, () => ({ selectionError: false }));
      if (chats.get(chatId)?.messages.length) {
        const save = (selections.get(chatId) ?? Promise.resolve())
          .catch(() => undefined)
          .then(async () => {
            const response = await deps.request(pathOf(chatId), {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ model }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
          });
        selections.set(chatId, save);
        void save.catch(() => {
          if (selections.get(chatId) === save) update(chatId, () => ({ selectionError: true }));
        });
      }
    },
    choose(chatId, deckId) {
      update(chatId, () => ({ deckId }));
      void deps.request(`/chats/${encodeURIComponent(chatId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deckId }),
      });
    },
    async forDeck(deckId) {
      for (const chat of chats.values()) {
        if (chat.deckId === deckId) return chat.chatId;
      }
      const response = await deps.request(`/chats?deckId=${encodeURIComponent(deckId)}`);
      if (!response.ok) return null;
      const rows = (await response.json()) as unknown;
      const chat = Array.isArray(rows) ? chatSummaryOf(rows[0]) : null;
      if (!chat) return null;
      await store.load(chat.chatId);
      return chat.chatId;
    },
    async retryVariant(chatId, buildId, variant) {
      const response = await deps.request(`/chats/${encodeURIComponent(chatId)}/variants/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ buildId, variant }),
      });
      if (!response.ok) throw new Error(await failureOf(response));
      const part = chatPartSchema.safeParse(await response.json());
      if (part.success && part.data.type === 'result') putResult(chatId, part.data);
      watchRebuild(chatId, buildId);
    },
  };

  type ResultPart = Extract<ChatPart, { type: 'result' }>;

  /** Заменить итог сборки в чате вкладки, не трогая остальной разговор. */
  const putResult = (chatId: string, result: ResultPart) => {
    update(chatId, (chat) => ({
      messages: chat.messages.map((message) =>
        message.role === 'assistant'
          ? {
              ...message,
              parts: message.parts.map((part) =>
                part.type === 'result' && part.buildId === result.buildId ? result : part,
              ),
            }
          : message,
      ),
    }));
  };

  const rebuilding = new Set<string>();

  /** Спрашивать сервер, пока вариант сборки пересобирается; итог сменяет тот, что во вкладке. */
  const watchRebuild = (chatId: string, buildId: string) => {
    const key = `${chatId}:${buildId}`;
    if (rebuilding.has(key)) return;
    rebuilding.add(key);
    const poll = async () => {
      try {
        const response = await deps.request(`/chats/${encodeURIComponent(chatId)}`);
        const document = response.ok ? chatDocumentOf(await response.json()) : null;
        const result = document?.messages
          .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
          .find((part): part is ResultPart => part.type === 'result' && part.buildId === buildId);
        if (result) putResult(chatId, result);
        // Чата больше нет или итог дописан — спрашивать нечего.
        if (!result || !result.failed?.some((item) => item.status === 'retrying')) {
          rebuilding.delete(key);
          if (result) deps.onTurnEnd?.(chatId);
          return;
        }
      } catch {
        // Сеть моргнула: спросим в следующий раз.
      }
      setTimeout(() => void poll(), REBUILD_POLL_MS);
    };
    setTimeout(() => void poll(), REBUILD_POLL_MS);
  };

  return store;
}
