import type { DesignSystem, LayoutVariant, SlideIr } from '@lct/contracts';
import type { TemplateSummary } from './library-source';
import type { ContextMention, SlideRefAttachment } from './slide-context';

/**
 * Разговоры с ассистентом: запрос человека, ответы агента, ход генерации и вопросы с вариантами.
 * Разговор начинается в поле ввода, продолжается в панели «Ассистент» редактора и переживает
 * переход между страницами — поэтому живёт здесь, а не в компоненте.
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
        | 'opened'
        | 'openedNoProject'
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

/** Картинка варианта: слайд и профиль шаблона, которым он нарисован. */
export interface OptionPreview {
  readonly slide: SlideIr;
  readonly designSystem: DesignSystem;
}

export type AudienceOption = 'leadership' | 'clients' | 'team';

/** Что делать с только что разобранным шаблоном, если колода собирается в проекте. */
export type AttachTemplateOption = 'attach' | 'deckOnly';

/**
 * Вопрос агента с вариантами ответа, как `AskUserQuestion`. Подписи — в словаре по id, а то, что
 * в них подставляется (имя проекта), лежит в вопросе данными: подпись собирается на языке
 * интерфейса в момент показа.
 */
export type AssistantQuestion =
  | {
      readonly questionId: 'audience';
      readonly options: readonly { readonly optionId: AudienceOption }[];
    }
  | {
      readonly questionId: 'attachTemplate';
      /** Проект, к которому агент предлагает прикрепить шаблон: его имя — в заголовке и подписи. */
      readonly projectName: string;
      readonly options: readonly { readonly optionId: AttachTemplateOption }[];
      readonly defaultOptionId: AttachTemplateOption;
    }
  | {
      readonly questionId: 'variant';
      readonly options: readonly {
        readonly optionId: LayoutVariant;
        readonly deckId: string;
        readonly slideCount: number;
        readonly preview: OptionPreview;
      }[];
      readonly defaultOptionId: LayoutVariant;
    };

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
  | { readonly kind: 'work'; readonly id: string; readonly runId: string }
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
    };

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
  get(threadId: string): AssistantThread | undefined;
  /** Разговор, который открыл эту колоду, — его продолжает панель редактора. */
  forDeck(deckId: string): AssistantThread | undefined;
  subscribe(listener: () => void): () => void;
  append(threadId: string, message: NewThreadMessage): string;
  /** Ответить на вопрос. Отвеченный вопрос второй раз не отвечается. */
  answer(threadId: string, messageId: string, answer: AssistantAnswer): void;
  setDeck(threadId: string, deckId: string): void;
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
    get: (threadId) => threads.get(threadId),
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
    setDeck: (threadId, deckId) => update(threadId, () => ({ deckId })),
    pendingQuestion,
  };
}
