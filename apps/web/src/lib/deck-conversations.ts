import type { AssistantThreads, MessageAttachment, RequestMeta } from './assistant-threads';
import type { GenerationRequest } from './deck-generator';
import type { GenerationRun, GenerationRuns } from './generation-runs';
import type { TemplateSummary } from './library-source';
import type { TemplateImport, TemplateImports } from './template-imports';

/**
 * Демо-агент разговора о новой колоде. Ведёт сценарий, который потом поведёт настоящий агент на
 * стороне TypeScript: принять запрос, разобрать новый шаблон, если его приложили (и в проекте —
 * спросить, прикрепить ли его к проекту), при коротком брифе уточнить аудиторию, собрать колоду и
 * спросить, какой вариант вёрстки оставить. Вопросы —
 * сообщения разговора, ответы на них приходят из интерфейса через `AssistantThreads.answer`.
 *
 * Сам агент ничего не пишет и не разбирает: шаблон импортирует `TemplateImports`, генерацию
 * делает `DeckGenerator`, а уточнение аудитории уходит в бриф текстом ответа — так его увидит
 * модель, которая пишет слайды.
 */

/** Бриф короче этого, без файлов, — повод спросить, для кого презентация. */
export const SHORT_BRIEF_WORDS = 8;

/**
 * Запрос из поля генерации. Шаблон приходит одним из двух путей: `templateId` — шаблон
 * библиотеки, `templateFile` — новый файл, который агент сначала импортирует, и тогда
 * `templateId` генерации узнаётся только после разбора.
 */
export type DeckDraft = Omit<GenerationRequest, 'templateId'> & {
  /** Шаблон библиотеки; null — шаблон приходит файлом `templateFile`. */
  readonly templateId: string | null;
};

export interface NewDeckInput {
  readonly request: DeckDraft;
  /** Новый файл шаблона: заменяет `request.templateId`. Годность файла поле уже проверило. */
  readonly templateFile: File | null;
  /**
   * Имя проекта `request.projectId`: им агент называет проект, когда спрашивает, прикрепить ли
   * к нему новый шаблон. Вне проектов — null.
   */
  readonly projectName: string | null;
  readonly meta: RequestMeta;
  /** Откуда начат разговор: туда ведёт «Назад», пока колоды нет. */
  readonly returnHref: string;
}

export interface DeckConversations {
  /** Начать разговор о новой колоде. Отдаёт id разговора — по нему открывается редактор. */
  start(input: NewDeckInput): string;
  /** Сообщение из поля панели, когда вопросов нет. Демо-агент честно отвечает, что не умеет. */
  say(threadId: string, text: string): void;
  /** Где начат разговор. */
  returnHref(threadId: string): string | undefined;
}

export function needsAudience(request: Pick<GenerationRequest, 'brief' | 'files'>): boolean {
  const words = request.brief.split(/\s+/).filter(Boolean).length;
  return request.files.length === 0 && words < SHORT_BRIEF_WORDS;
}

/** Что человек приложил к первому сообщению: шаблон первым, как чип в поле. */
export function requestAttachments({
  request,
  templateFile,
}: Pick<NewDeckInput, 'request' | 'templateFile'>): readonly MessageAttachment[] {
  return [
    ...(templateFile
      ? [{ kind: 'template' as const, name: templateFile.name, size: templateFile.size }]
      : []),
    ...request.files.map((file) => ({ kind: 'file' as const, name: file.name, size: file.size })),
  ];
}

/**
 * Прикрепить шаблон библиотеки к проекту. Отказ — `ok: false` или исключение: для разговора это
 * одно и то же, агент скажет, что не вышло, и соберёт колоду дальше.
 */
export type AttachTemplate = (
  projectId: string,
  templateId: string,
) => Promise<{ readonly ok: boolean }>;

export function createDeckConversations({
  threads,
  runs,
  imports,
  attachTemplate,
}: {
  threads: AssistantThreads;
  runs: GenerationRuns;
  /** Импорты шаблонов: через них агент разбирает файл шаблона, приложенный к запросу. */
  imports: TemplateImports;
  /**
   * Прикрепление шаблона к проекту. Во вкладке это серверное действие — библиотеку проектов
   * держит сервер, — но разговор о нём не знает: зависимость приходит снаружи и в тестах
   * подменяется.
   */
  attachTemplate: AttachTemplate;
}): DeckConversations {
  const origins = new Map<string, string>();

  /** Ждать, пока на вопрос ответят. */
  const answerOf = (threadId: string, messageId: string) =>
    new Promise<{ optionId: string | null; text: string }>((resolve) => {
      const check = () => {
        const message = threads.get(threadId)?.messages.find((item) => item.id === messageId);
        if (message?.kind === 'ask' && message.answer) {
          stop();
          resolve(message.answer);
        }
      };
      const stop = threads.subscribe(check);
      check();
    });

  /** Ждать, пока прогон закончится: готово, сбой или отмена. */
  const finished = (runId: string) =>
    new Promise<GenerationRun>((resolve) => {
      const check = () => {
        const run = runs.get(runId);
        if (run && run.phase !== 'running') {
          stop();
          resolve(run);
        }
      };
      const stop = runs.subscribe(check);
      check();
    });

  /** Ждать, пока импорт закончится: готово или сбой. */
  const imported = (importId: string) =>
    new Promise<TemplateImport>((resolve) => {
      const check = () => {
        const item = imports.get(importId);
        if (item && item.phase !== 'running') {
          stop();
          resolve(item);
        }
      };
      const stop = imports.subscribe(check);
      check();
    });

  /** Ждать, пока импорт запустят снова — повтором из карточки разбора. */
  const reimported = (importId: string) =>
    new Promise<void>((resolve) => {
      const stop = imports.subscribe(() => {
        if (imports.get(importId)?.phase === 'running') {
          stop();
          resolve();
        }
      });
    });

  /**
   * Разобрать файл шаблона, приложенный к запросу: карточка хода разбора, затем карточка итога.
   * Отдаёт зарегистрированный шаблон.
   *
   * Повторяемый сбой — не конец разговора, как и у прогона генерации: карточка разбора даёт
   * разобрать файл снова, и разговор продолжается с того же места. Сбой, который повтором не
   * лечится (движок назвал файл негодным), — null: агент говорит об этом, и разговор кончается.
   */
  const importTemplate = async (threadId: string, file: File): Promise<TemplateSummary | null> => {
    const failed = () => {
      threads.append(threadId, {
        kind: 'agent',
        text: { key: 'templateImportFailed', values: { template: file.name } },
      });
      return null;
    };
    let importId: string;
    try {
      importId = imports.start(file);
    } catch {
      // Негодный файл поле не пропускает; если всё же дошёл — это такой же сбой разбора.
      return failed();
    }
    threads.append(threadId, { kind: 'import', importId });

    let item = await imported(importId);
    while (item.phase !== 'done' || !item.result) {
      if (item.failure?.retryable === false) return failed();
      await reimported(importId);
      item = await imported(importId);
    }
    threads.append(threadId, { kind: 'template', template: item.result });
    return item.result;
  };

  /**
   * Куда деть новый шаблон. В проекте агент спрашивает, прикрепить ли его к проекту: тогда
   * шаблон появится в выборе шаблона у следующих презентаций проекта. Вне проекта спрашивать не
   * о чем — шаблон уже в библиотеке, агент говорит об этом одной строкой.
   *
   * Сбой прикрепления разговор не останавливает: колода собирается новым шаблоном в любом
   * случае, прикрепить его можно и потом, на странице проекта.
   */
  const placeTemplate = async (
    threadId: string,
    template: TemplateSummary,
    { request, projectName }: NewDeckInput,
  ) => {
    const { projectId } = request;
    if (projectId === null) {
      threads.append(threadId, { kind: 'agent', text: { key: 'templateSaved' } });
      return;
    }
    const project = projectName ?? '';
    const askId = threads.append(threadId, {
      kind: 'ask',
      question: {
        questionId: 'attachTemplate',
        projectName: project,
        options: [{ optionId: 'attach' }, { optionId: 'deckOnly' }],
        defaultOptionId: 'attach',
      },
      answer: null,
    });
    const answer = await answerOf(threadId, askId);
    if (answer.optionId !== 'attach') {
      threads.append(threadId, { kind: 'agent', text: { key: 'templateSaved' } });
      return;
    }
    const attached = await attachTemplate(projectId, template.templateId).then(
      (result) => result.ok,
      () => false,
    );
    threads.append(threadId, {
      kind: 'agent',
      text: {
        key: attached ? 'templateAttached' : 'templateAttachFailed',
        values: { project },
      },
    });
  };

  /** Ждать, пока прогон запустят снова. */
  const restarted = (runId: string) =>
    new Promise<void>((resolve) => {
      const stop = runs.subscribe(() => {
        if (runs.get(runId)?.phase === 'running') {
          stop();
          resolve();
        }
      });
    });

  const converse = async (threadId: string, input: NewDeckInput) => {
    const { request, templateFile, meta, returnHref } = input;
    let templateId = request.templateId;
    if (templateFile) {
      const template = await importTemplate(threadId, templateFile);
      if (!template) return;
      await placeTemplate(threadId, template, input);
      templateId = template.templateId;
    }
    if (templateId === null) throw new Error('Deck request without a template');

    let brief = request.brief;
    if (needsAudience(request)) {
      const askId = threads.append(threadId, {
        kind: 'ask',
        question: {
          questionId: 'audience',
          options: [{ optionId: 'leadership' }, { optionId: 'clients' }, { optionId: 'team' }],
        },
        answer: null,
      });
      const answer = await answerOf(threadId, askId);
      brief = `${brief}\n\n${answer.text}`.trim();
    }

    threads.append(threadId, {
      kind: 'agent',
      text: { key: 'building', values: { template: meta.templateName } },
    });
    const runId = runs.start({ ...request, templateId, brief }, returnHref);
    threads.append(threadId, { kind: 'work', runId });

    // Сбой или отмена — не конец разговора: карточка хода даёт запустить прогон снова, и тогда
    // разговор продолжается с того же места.
    let run = await finished(runId);
    while (run.phase !== 'done' || !run.result) {
      if (run.phase === 'cancelled')
        threads.append(threadId, { kind: 'agent', text: { key: 'stopped' } });
      await restarted(runId);
      run = await finished(runId);
    }

    const variants = run.result.variants;
    const askId = threads.append(threadId, {
      kind: 'ask',
      question: {
        questionId: 'variant',
        options: variants.map((item) => ({
          optionId: item.variant,
          deckId: item.deckId,
          slideCount: item.slideCount,
          preview: { slide: item.cover, designSystem: item.designSystem },
        })),
        defaultOptionId: 'balanced',
      },
      answer: null,
    });
    const answer = await answerOf(threadId, askId);
    const chosen = variants.find((item) => item.variant === answer.optionId);
    if (!chosen) {
      threads.append(threadId, { kind: 'agent', text: { key: 'unsupported' } });
      return;
    }
    // Где лежат два других варианта, зависит от того, где собрана колода: в проекте или вне.
    threads.append(threadId, {
      kind: 'agent',
      text: {
        key: request.projectId === null ? 'openedNoProject' : 'opened',
        values: { variant: chosen.variant },
      },
    });
    threads.setDeck(threadId, chosen.deckId);
  };

  return {
    start(input) {
      if (input.templateFile === null && input.request.templateId === null) {
        throw new Error('Deck request without a template');
      }
      const threadId = threads.create(input.request.projectId);
      origins.set(threadId, input.returnHref);
      threads.append(threadId, {
        kind: 'user',
        text: input.request.brief,
        attachments: requestAttachments(input),
        meta: input.meta,
      });
      void converse(threadId, input);
      return threadId;
    },
    say(threadId, text) {
      threads.append(threadId, { kind: 'user', text, attachments: [], meta: null });
      threads.append(threadId, { kind: 'agent', text: { key: 'unsupported' } });
    },
    returnHref: (threadId) => origins.get(threadId),
  };
}
