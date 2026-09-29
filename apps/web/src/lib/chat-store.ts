import type {
  ChatAnswer,
  ChatAttachment,
  ChatMessage,
  ChatMode,
  ChatTurnInput,
  DeckOutline,
  ModelRef,
} from '@lct/contracts';
import { chatDocumentOf, chatSummaryOf } from './chat-records';
import { applyChatEvent, readChatEvents } from './chat-stream';

/** Вложение сообщения, пока оно едет на сервер: имя и вид, id ещё нет. */
export interface LocalAttachment {
  readonly kind: 'file' | 'template' | 'context';
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
  /** Колода, которую ведёт чат. */
  readonly deckId: string | null;
}

/** Что человек отправляет из поля: текст и файлы, шаблон файлом или из библиотеки. */
export interface ComposedMessage {
  readonly text: string;
  readonly files: readonly File[];
  readonly templateFile?: File | null;
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
  /** Ход закончился: списки чатов и колод на серверных страницах стоит обновить. */
  readonly onTurnEnd?: (chatId: string) => void;
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
  approve(chatId: string, planId: string, outline: DeckOutline, templateId: string): void;
  cancel(chatId: string): void;
  setMode(chatId: string, mode: ChatMode): void;
  setModel(chatId: string, model: ModelRef | null): void;
  /** Выбрать вариант, к которому ведёт чат. */
  choose(chatId: string, deckId: string): void;
  /** Чат, в котором собрана колода, во вкладке; его id или null. */
  forDeck(deckId: string): Promise<string | null>;
}

/** Название нового чата — его первые слова, как их назовёт и сервер. */
function draftTitle(text: string, attachments: readonly LocalAttachment[]): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return (line || attachments[0]?.name || '').slice(0, 60);
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
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const update = (chatId: string, patch: (chat: ChatView) => Partial<ChatView>) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    chats.set(chatId, { ...chat, ...patch(chat) });
    notify();
  };

  /** Читать ход, пока он не кончится. Сообщение человека от сервера сменяет черновик. */
  const follow = async (chatId: string, response: Response) => {
    if (!response.body) return;
    update(chatId, () => ({ running: true }));
    try {
      await readChatEvents(response.body, (event) =>
        update(chatId, (chat) => ({
          messages: applyChatEvent(chat.messages, event),
          ...(event.type === 'message' && event.message.role === 'user' ? { pending: null } : {}),
        })),
      );
    } finally {
      update(chatId, () => ({ running: false }));
      deps.onTurnEnd?.(chatId);
    }
  };

  const attach = async (chatId: string) => {
    const response = await deps.request(`/chats/${encodeURIComponent(chatId)}/stream`);
    if (response.ok) await follow(chatId, response);
  };

  const turn = async (chatId: string, input: ChatTurnInput, slideCount: number | null = null) => {
    const chat = chats.get(chatId);
    if (!chat) return;
    const response = await deps.request(`/chats/${encodeURIComponent(chatId)}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: chat.mode,
        model: chat.model,
        projectId: chat.projectId,
        deckId: chat.deckId,
        slideCount,
        input,
      }),
    });
    if (!response.ok) throw new Error(await failureOf(response));
    await follow(chatId, response);
  };

  /** Загрузить вложения и отправить сообщение. Сбой остаётся в черновике — его видно в ленте. */
  const deliver = (chatId: string, message: ComposedMessage) => {
    const attachments: LocalAttachment[] = [
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
      ...message.files.map((file) => ({ kind: 'file' as const, name: file.name, size: file.size })),
      ...(message.context ?? []).map((item) => ({ kind: 'context' as const, name: item.name })),
    ];
    update(chatId, () => ({
      pending: { text: message.text, attachments, failed: null },
      running: true,
    }));
    void (async () => {
      const sent: ChatAttachment[] = [];
      if (message.templateFile) {
        const { templateId, name } = await deps.uploadTemplate(message.templateFile);
        sent.push({ kind: 'template', templateId, name });
      } else if (message.template) {
        sent.push({ kind: 'template', ...message.template });
      }
      for (const file of message.files) {
        const { fileId, name, size } = await deps.uploadContent(file);
        sent.push({ kind: 'file', fileId, name, size });
      }
      sent.push(...(message.context ?? []));
      await turn(
        chatId,
        { type: 'message', text: message.text.trim(), attachments: sent },
        message.slideCount ?? null,
      );
    })().catch((error: unknown) =>
      update(chatId, (chat) => ({
        running: false,
        pending: chat.pending && {
          ...chat.pending,
          failed: error instanceof Error ? error.message : '',
        },
      })),
    );
  };

  /** Ход без черновика: ответ на вопрос или одобрение плана. Сбой показывается ошибкой в ленте. */
  const act = (chatId: string, input: ChatTurnInput) => {
    update(chatId, () => ({ running: true }));
    void turn(chatId, input).catch((error: unknown) =>
      update(chatId, () => ({
        running: false,
        pending: {
          text: '',
          attachments: [],
          failed: error instanceof Error ? error.message : '',
        },
      })),
    );
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
          model: null,
          messages: document.messages,
          running: document.running,
          pending: null,
          deckId: document.deckId,
        });
        notify();
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
    approve(chatId, planId, outline, templateId) {
      act(chatId, { type: 'approve-plan', planId, outline, templateId });
    },
    cancel(chatId) {
      void deps.request(`/chats/${encodeURIComponent(chatId)}/cancel`, { method: 'POST' });
    },
    setMode(chatId, mode) {
      update(chatId, () => ({ mode }));
    },
    setModel(chatId, model) {
      update(chatId, () => ({ model }));
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
  };
  return store;
}
