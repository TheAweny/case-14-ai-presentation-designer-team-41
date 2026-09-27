import type { LayoutVariant } from '@lct/contracts';
import {
  DEFAULT_AUDIENCE,
  type AssistantThreads,
  type AudienceOption,
  type MessageAttachment,
  type RequestMeta,
  type VariantReview,
} from './assistant-threads';
import type { GeneratedVariant, GenerationRequest } from './deck-generator';
import type { GenerationRun, GenerationRuns } from './generation-runs';
import type { TemplateSummary } from './library-source';
import type { ModelRef } from './model-settings';
import { contextMentions } from './slide-context';
import type { TemplateImport, TemplateImports } from './template-imports';

/**
 * Демо-агент разговора о новой колоде. Ведёт сценарий, который потом поведёт настоящий агент на
 * стороне TypeScript: принять запрос, разобрать новый шаблон, если его приложили (и в проекте —
 * спросить, прикрепить ли его к проекту), собрать колоду, проверить три варианта аудитом и
 * посоветовать один.
 *
 * Готовый результат не должен ждать человека. Поэтому агент спрашивает, только когда без ответа
 * дальше нельзя (куда деть новый шаблон). Остальное он предполагает сам и говорит об этом
 * карточкой допущения. Вариант вёрстки он тоже не спрашивает: три готовых варианта и совет лежат
 * в итоге, открыть можно любой.
 *
 * Сам агент ничего не пишет и не разбирает: шаблон импортирует `TemplateImports`, генерацию
 * делает `DeckGenerator`, аудит — `review`. Допущение об аудитории и пожелания человека уходят в
 * бриф текстом — так их увидит модель, которая пишет слайды.
 */

/** Бриф короче этого, без файлов, — повод предположить, для кого презентация. */
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
  /** Откуда начат разговор: туда ведёт «Назад». */
  readonly returnHref: string;
  /**
   * Аудитория словами, на языке интерфейса: так допущение агента уходит в бриф. Подписи даёт
   * интерфейс — у агента нет словаря.
   */
  readonly audienceLabels: Readonly<Record<AudienceOption, string>>;
}

export interface DeckConversations {
  /** Начать разговор о новой колоде. Отдаёт id разговора — по нему открывается его страница. */
  start(input: NewDeckInput): string;
  /**
   * Сообщение из поля панели редактора, когда вопросов нет. `attachments` — то, что человек дал
   * как контекст: объекты и слайды колоды со снимком SlideIR. Они остаются в сообщении человека —
   * настоящий агент прочитает их оттуда. Демо-агент честно говорит, что видит, и что править
   * по просьбе пока не умеет.
   */
  say(threadId: string, text: string, attachments?: readonly MessageAttachment[]): void;
  /**
   * Пожелание к новой колоде — пока её собирают или когда она готова. Агент добавляет его к
   * брифу и собирает заново; идущую сборку сменяет новая. Сборка ещё не началась (разбирается
   * шаблон) — пожелание войдёт в неё.
   */
  refine(threadId: string, text: string, files?: readonly File[]): void;
  /**
   * Другая аудитория вместо допущения агента. `text` — реплика человека на языке интерфейса.
   * Колода пересобирается.
   */
  reassume(threadId: string, messageId: string, audience: AudienceOption, text: string): void;
  /**
   * Та же колода в другом шаблоне библиотеки: тот же бриф, те же пожелания. Так видно, что
   * вёрстка следует шаблону, а не зашитому сценарию.
   */
  rebuildWithTemplate(
    threadId: string,
    template: { readonly templateId: string; readonly name: string },
    text: string,
  ): void;
  /** Где начат разговор. */
  returnHref(threadId: string): string | undefined;
  /**
   * Модель, которой пишется текст следующей сборки; null — модель по умолчанию. undefined —
   * разговор не собирает колоду (его начали в панели редактора), и модель выбирать не для чего.
   */
  modelOf(threadId: string): ModelRef | null | undefined;
  /** Сменить модель: ею напишется текст следующей сборки. Идущую сборку смена не трогает. */
  setModel(threadId: string, model: ModelRef | null): void;
}

/**
 * Аудит вариантов: по `deckId` — сколько ошибок и замечаний. Во вкладке это проверки
 * `@lct/slide-audit` над слайдами колоды; в тестах подменяется.
 */
export type ReviewVariants = (
  variants: readonly GeneratedVariant[],
) => Promise<Readonly<Record<string, VariantReview>>>;

/** Порядок, в котором агент советует варианты при равном аудите. */
const PREFERENCE: readonly LayoutVariant[] = ['balanced', 'dense', 'airy'];

/**
 * Какой вариант советовать: меньше ошибок, затем меньше замечаний, затем сбалансированный.
 * Без аудита — сбалансированный, если он есть.
 */
export function recommendVariant(
  variants: readonly GeneratedVariant[],
  reviews: Readonly<Record<string, VariantReview>> | null,
): LayoutVariant {
  const rank = (variant: LayoutVariant) => {
    const at = PREFERENCE.indexOf(variant);
    return at < 0 ? PREFERENCE.length : at;
  };
  const sorted = [...variants].sort((a, b) => {
    const ra = reviews?.[a.deckId];
    const rb = reviews?.[b.deckId];
    if (ra && rb) {
      if (ra.errors !== rb.errors) return ra.errors - rb.errors;
      if (ra.warnings !== rb.warnings) return ra.warnings - rb.warnings;
    }
    return rank(a.variant) - rank(b.variant);
  });
  const best = sorted[0];
  if (!best) throw new Error('No variants to recommend');
  return best.variant;
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

/** Что агент помнит о разговоре, начатом полем: из этого собирается каждая сборка. */
interface ConversationState {
  readonly input: NewDeckInput;
  /** Шаблон сборки; null — новый файл шаблона ещё разбирается. */
  templateId: string | null;
  templateName: string;
  /** Для кого колода, если бриф этого не сказал; null — бриф сказал сам. */
  audience: AudienceOption | null;
  /** Пожелания человека по ходу разговора, по порядку. */
  readonly refinements: string[];
  /** Материалы, добавленные после старта разговора; входят в следующую сборку. */
  files: readonly File[];
  /** Модель для следующей сборки; null означает модель по умолчанию. */
  model: ModelRef | null;
  /** Номер сборки: сборка, которую сменила новая, уходит молча. */
  build: number;
  /** Прогон последней сборки; null — сборка ещё не начиналась. */
  runId: string | null;
}

/** Бриф сборки: запрос человека, допущение об аудитории и пожелания — абзацами. */
function briefOf({ input, audience, refinements }: ConversationState): string {
  return [input.request.brief, audience ? input.audienceLabels[audience] : '', ...refinements]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n');
}

export function createDeckConversations({
  threads,
  runs,
  imports,
  attachTemplate,
  review,
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
  /** Аудит готовых вариантов; без него агент советует без аудита. */
  review?: ReviewVariants;
}): DeckConversations {
  const states = new Map<string, ConversationState>();

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

  /**
   * Собрать колоду по тому, что агент знает сейчас: карточка хода, затем итог с аудитом. Новая
   * сборка сменяет идущую: та останавливается и уходит молча.
   *
   * Сбой или отмена — не конец разговора: карточка хода даёт запустить прогон снова, и тогда
   * разговор продолжается с того же места.
   */
  const build = async (threadId: string, state: ConversationState) => {
    if (state.templateId === null) return;
    state.build += 1;
    const ticket = state.build;
    const current = () => state.build === ticket;
    if (state.runId !== null) runs.cancel(state.runId);

    threads.append(threadId, {
      kind: 'agent',
      text: { key: 'building', values: { template: state.templateName } },
    });
    const runId = runs.start(
      {
        ...state.input.request,
        templateId: state.templateId,
        brief: briefOf(state),
        files: state.files,
        model: state.model,
      },
      state.input.returnHref,
    );
    state.runId = runId;
    threads.append(threadId, { kind: 'work', runId });

    let run = await finished(runId);
    while (run.phase !== 'done' || !run.result) {
      if (!current()) return;
      if (run.phase === 'cancelled') {
        threads.append(threadId, { kind: 'agent', text: { key: 'stopped' } });
      }
      await restarted(runId);
      run = await finished(runId);
    }
    if (!current()) return;

    const { variants, templateSubstituted } = run.result;
    const reviews = review ? await review(variants).catch(() => null) : null;
    if (!current()) return;
    threads.append(threadId, {
      kind: 'result',
      result: {
        runId,
        variants,
        reviews,
        recommended: recommendVariant(variants, reviews),
        templateSubstituted,
        elapsedMs: run.finishedAt === null ? null : run.finishedAt - run.startedAt,
      },
    });
  };

  const converse = async (threadId: string, state: ConversationState) => {
    const { input } = state;
    if (input.templateFile) {
      const template = await importTemplate(threadId, input.templateFile);
      if (!template) return;
      await placeTemplate(threadId, template, input);
      state.templateId = template.templateId;
    }
    if (state.templateId === null) throw new Error('Deck request without a template');

    if (needsAudience(input.request)) {
      state.audience = DEFAULT_AUDIENCE;
      threads.append(threadId, { kind: 'assume', audience: DEFAULT_AUDIENCE, changed: false });
    }
    await build(threadId, state);
  };

  /** Пересобрать, если сборка уже была. Нет — новое войдёт в первую сборку. */
  const rebuild = (threadId: string, state: ConversationState) => {
    if (state.runId === null) return false;
    void build(threadId, state);
    return true;
  };

  return {
    start(input) {
      if (input.templateFile === null && input.request.templateId === null) {
        throw new Error('Deck request without a template');
      }
      const threadId = threads.create(input.request.projectId);
      const state: ConversationState = {
        input,
        templateId: input.templateFile ? null : input.request.templateId,
        templateName: input.meta.templateName,
        audience: null,
        refinements: [],
        files: input.request.files,
        model: input.request.model,
        build: 0,
        runId: null,
      };
      states.set(threadId, state);
      threads.append(threadId, {
        kind: 'user',
        text: input.request.brief,
        attachments: requestAttachments(input),
        meta: input.meta,
      });
      void converse(threadId, state);
      return threadId;
    },
    say(threadId, text, attachments = []) {
      threads.append(threadId, { kind: 'user', text, attachments, meta: null });
      const seen = contextMentions(attachments);
      threads.append(threadId, {
        kind: 'agent',
        text: seen.length > 0 ? { key: 'contextSeen', seen } : { key: 'unsupported' },
      });
    },
    refine(threadId, text, files = []) {
      const state = states.get(threadId);
      const wish = text.trim();
      if (!state || (wish === '' && files.length === 0)) return;
      if (wish !== '') state.refinements.push(wish);
      const same = (a: File, b: File) =>
        a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
      const added = files.filter((file) => !state.files.some((existing) => same(existing, file)));
      state.files = [...state.files, ...added];
      threads.append(threadId, {
        kind: 'user',
        text: wish,
        attachments: added.map((file) => ({
          kind: 'file' as const,
          name: file.name,
          size: file.size,
        })),
        meta: null,
      });
      if (!rebuild(threadId, state)) {
        threads.append(threadId, { kind: 'agent', text: { key: 'refining' } });
      }
    },
    reassume(threadId, messageId, audience, text) {
      const state = states.get(threadId);
      if (!state || state.audience === audience) return;
      state.audience = audience;
      threads.reassume(threadId, messageId, audience);
      threads.append(threadId, { kind: 'user', text, attachments: [], meta: null });
      rebuild(threadId, state);
    },
    rebuildWithTemplate(threadId, template, text) {
      const state = states.get(threadId);
      if (!state || state.runId === null || state.templateId === template.templateId) return;
      state.templateId = template.templateId;
      state.templateName = template.name;
      threads.append(threadId, { kind: 'user', text, attachments: [], meta: null });
      rebuild(threadId, state);
    },
    returnHref: (threadId) => states.get(threadId)?.input.returnHref,
    modelOf: (threadId) => states.get(threadId)?.model,
    setModel(threadId, model) {
      const state = states.get(threadId);
      if (state) state.model = model;
    },
  };
}
