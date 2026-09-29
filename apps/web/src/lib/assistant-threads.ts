import type { LayoutVariant } from '@lct/contracts';
import type { GeneratedVariant, ServerRun } from './deck-generator';
import type { TemplateSummary } from './library-source';
import type { ContextMention, SlideRefAttachment } from './slide-context';

/**
 * Разговоры с ассистентом: запрос человека, ответы агента, ход генерации и вопросы с вариантами.
 * Разговор начинается в поле ввода, продолжается в панели «Ассистент» редактора и переживает
 * переход между страницами — поэтому живёт здесь, а не в компоненте. Сохраняет разговоры в API
 * синхронизация чатов (`chat-records.ts`), она же возвращает их после обновления страницы.
 *
 * Тексты демо-агента хранятся ключами словаря, а не строками: язык интерфейса можно сменить
 * посреди разговора. Ответ настоящей модели придёт готовым текстом — для него есть `raw`.
 */

/** Что говорит агент: ключ словаря `assistant.agent` с параметрами или готовый текст модели. */
export type AgentText =
  | {
      readonly key:
        | 'building'
        | 'stopped'
        | 'refining'
        | 'unsupported'
        | 'templateImportFailed'
        | 'templateSaved'
        | 'templateAttached'
        | 'templateAttachFailed';
      readonly values?: Readonly<Record<string, string>>;
    }
  /**
   * Агент подтверждает, что видит объекты, которые человек дал как контекст. Упоминания —
   * данными, а не строкой: «заголовок на слайде 3» собирается на языке интерфейса при показе.
   */
  | { readonly key: 'contextSeen'; readonly seen: readonly ContextMention[] }
  | { readonly raw: string };

/** Подписи в первом сообщении: чем и сколько собирать. */
export interface RequestMeta {
  readonly templateName: string;
  readonly slideCount: number | null;
  /** Подпись модели, если её выбирали; null — модель по умолчанию. */
  readonly modelName: string | null;
}

/**
 * Что человек приложил к сообщению. Виды одного ряда — чипы в поле и в сообщении выглядят
 * одинаково.
 */
export type MessageAttachment =
  /** Материал контент-пака. */
  | { readonly kind: 'file'; readonly name: string; readonly size: number }
  /** Новый файл шаблона: агент сначала его разберёт. */
  | { readonly kind: 'template'; readonly name: string; readonly size: number }
  /**
   * Объекты слайда или слайд целиком как контекст — со снимком SlideIR на момент отправки
   * (см. `slide-context.ts`).
   */
  | SlideRefAttachment;

export type AudienceOption = 'leadership' | 'clients' | 'team';

/** Для кого колода, если бриф этого не сказал: агент берёт это, пока человек не поправит. */
export const DEFAULT_AUDIENCE: AudienceOption = 'leadership';

export const AUDIENCE_OPTIONS: readonly AudienceOption[] = ['leadership', 'clients', 'team'];

/** Что делать с только что разобранным шаблоном, если колода собирается в проекте. */
export type AttachTemplateOption = 'attach' | 'deckOnly';

/**
 * Вопрос агента с вариантами ответа, как `AskUserQuestion`. Подписи — в словаре по id, а то, что
 * в них подставляется (имя проекта), лежит в вопросе данными: подпись собирается на языке
 * интерфейса в момент показа.
 *
 * Вопрос останавливает разговор, поэтому агент задаёт его, только когда без ответа нельзя
 * двигаться дальше. Там, где можно разумно предположить, он предполагает (`assume`).
 */
export type AssistantQuestion = {
  readonly questionId: 'attachTemplate';
  /** Проект, к которому агент предлагает прикрепить шаблон: его имя — в заголовке и подписи. */
  readonly projectName: string;
  readonly options: readonly { readonly optionId: AttachTemplateOption }[];
  readonly defaultOptionId: AttachTemplateOption;
};

/** Итог аудита одного варианта: сколько ошибок и замечаний нашла проверка слайдов. */
export interface VariantReview {
  readonly errors: number;
  readonly warnings: number;
}

/** Итог сборки: три варианта вёрстки одного плана, аудит каждого и выбор агента. */
export interface DeckResult {
  readonly runId: string;
  /** В порядке `LAYOUT_VARIANTS`. */
  readonly variants: readonly GeneratedVariant[];
  /** Аудит по `deckId` варианта; null — проверить не удалось, и агент выбрал без него. */
  readonly reviews: Readonly<Record<string, VariantReview>> | null;
  /** Вариант, который агент советует: меньше всего ошибок, при равенстве — сбалансированный. */
  readonly recommended: LayoutVariant;
  /** Колоды собраны не на выбранном шаблоне — так честно отвечает демо-генератор. */
  readonly templateSubstituted: boolean;
  /** От запуска прогона до готовности; null — неизвестно. */
  readonly elapsedMs: number | null;
}

/**
 * Ответ на вопрос. `text` — что увидит собеседник: подпись варианта или свои слова; `optionId`
 * есть, если выбран вариант.
 */
export interface AssistantAnswer {
  readonly optionId: string | null;
  readonly text: string;
}

export type ThreadMessage =
  | {
      readonly kind: 'user';
      readonly id: string;
      readonly text: string;
      readonly attachments: readonly MessageAttachment[];
      readonly meta: RequestMeta | null;
    }
  | { readonly kind: 'agent'; readonly id: string; readonly text: AgentText }
  | {
      readonly kind: 'work';
      readonly id: string;
      /** Прогон во вкладке: по нему карточка показывает ход. */
      readonly runId: string;
      /**
       * Прогон на сервере и когда начат, мс эпохи. По нему сборку досматривают после обновления
       * страницы; нет — сервер прогон ещё не принял.
       */
      readonly server?: ServerRun & { readonly startedAt: number };
    }
  /** Ход разбора шаблона: карточка следит за импортом по id, сбой повторяется из неё. */
  | { readonly kind: 'import'; readonly id: string; readonly importId: string }
  /**
   * Итог разбора: шаблон, как его зарегистрировала библиотека. Лежит в сообщении целиком, а не
   * ссылкой: карточка итога рисуется без запроса к библиотеке и не зависит от стора импортов.
   */
  | { readonly kind: 'template'; readonly id: string; readonly template: TemplateSummary }
  | {
      readonly kind: 'ask';
      readonly id: string;
      readonly question: AssistantQuestion;
      readonly answer: AssistantAnswer | null;
    }
  /**
   * Допущение вместо вопроса: агент выбрал сам и говорит, что выбрал, а сборка идёт дальше.
   * Поменять можно в любой момент — карточка покажет новый выбор, колода пересоберётся.
   */
  | {
      readonly kind: 'assume';
      readonly id: string;
      readonly audience: AudienceOption;
      /** Выбор человека, а не агента. */
      readonly changed: boolean;
    }
  | { readonly kind: 'result'; readonly id: string; readonly result: DeckResult };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Сообщение без id: id выдаёт стор. */
export type NewThreadMessage = DistributiveOmit<ThreadMessage, 'id'>;

export interface AssistantThread {
  readonly threadId: string;
  readonly messages: readonly ThreadMessage[];
  /** Колода, которую открыл разговор; до выбора варианта её нет. */
  readonly deckId: string | null;
  /** Проект, в который собирается колода; null — вне проектов. */
  readonly projectId: string | null;
}

export interface AssistantThreads {
  create(projectId: string | null): string;
  /**
   * Вернуть сохранённый разговор — после обновления страницы его приносит API. Разговор, который
   * уже есть во вкладке, не трогается: он новее сохранённого.
   */
  hydrate(thread: AssistantThread): void;
  get(threadId: string): AssistantThread | undefined;
  /** Все разговоры вкладки: их сохраняет синхронизация с API. */
  list(): readonly AssistantThread[];
  /** Разговор, который открыл эту колоду, — его продолжает панель редактора. */
  forDeck(deckId: string): AssistantThread | undefined;
  subscribe(listener: () => void): () => void;
  append(threadId: string, message: NewThreadMessage): string;
  /** Ответить на вопрос. Отвеченный вопрос второй раз не отвечается. */
  answer(threadId: string, messageId: string, answer: AssistantAnswer): void;
  /** Человек поменял допущение агента: карточка показывает его выбор. */
  reassume(threadId: string, messageId: string, audience: AudienceOption): void;
  setDeck(threadId: string, deckId: string): void;
  /** Сервер принял прогон сборки: сообщение о ней запоминает его. */
  setServerRun(
    threadId: string,
    messageId: string,
    server: ServerRun & { readonly startedAt: number },
  ): void;
  /** Вопрос, который ждёт ответа, — на него отвечает и поле панели. */
  pendingQuestion(threadId: string): Extract<ThreadMessage, { kind: 'ask' }> | undefined;
}

export function createAssistantThreads(
  newId: () => string = () => crypto.randomUUID(),
): AssistantThreads {
  const threads = new Map<string, AssistantThread>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const update = (
    threadId: string,
    patch: (thread: AssistantThread) => Partial<AssistantThread>,
  ) => {
    const thread = threads.get(threadId);
    if (!thread) return;
    threads.set(threadId, { ...thread, ...patch(thread) });
    notify();
  };

  const pendingQuestion = (threadId: string) =>
    threads
      .get(threadId)
      ?.messages.findLast(
        (message): message is Extract<ThreadMessage, { kind: 'ask' }> =>
          message.kind === 'ask' && message.answer === null,
      );

  return {
    create(projectId) {
      const threadId = newId();
      threads.set(threadId, { threadId, messages: [], deckId: null, projectId });
      notify();
      return threadId;
    },
    hydrate(thread) {
      if (threads.has(thread.threadId)) return;
      threads.set(thread.threadId, thread);
      notify();
    },
    get: (threadId) => threads.get(threadId),
    list: () => [...threads.values()],
    forDeck: (deckId) => [...threads.values()].findLast((thread) => thread.deckId === deckId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    append(threadId, message) {
      const id = newId();
      update(threadId, ({ messages }) => ({
        messages: [...messages, { ...message, id } as ThreadMessage],
      }));
      return id;
    },
    answer(threadId, messageId, answer) {
      update(threadId, ({ messages }) => ({
        messages: messages.map((message) =>
          message.id === messageId && message.kind === 'ask' && message.answer === null
            ? { ...message, answer }
            : message,
        ),
      }));
    },
    reassume(threadId, messageId, audience) {
      update(threadId, ({ messages }) => ({
        messages: messages.map((message) =>
          message.id === messageId && message.kind === 'assume'
            ? { ...message, audience, changed: true }
            : message,
        ),
      }));
    },
    setDeck: (threadId, deckId) => update(threadId, () => ({ deckId })),
    setServerRun(threadId, messageId, server) {
      update(threadId, ({ messages }) => ({
        messages: messages.map((message) =>
          message.id === messageId && message.kind === 'work' ? { ...message, server } : message,
        ),
      }));
    },
    pendingQuestion,
  };
}
