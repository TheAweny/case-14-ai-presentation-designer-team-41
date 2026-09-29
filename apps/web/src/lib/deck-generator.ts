import {
  layoutVariantSchema,
  runConfigSchema,
  type ContentItemKind,
  type DesignSystem,
  type JobErrorCode,
  type JobEvent,
  type JobStage,
  type LayoutVariant,
  type SlideIr,
} from '@lct/contracts';
import type { ModelRef } from './model-settings';

/**
 * Генерация новой презентации. Интерфейс знает только `DeckGenerator`: сейчас за ним
 * демо-источник, потом HTTP-клиент API. Шаблон к этому времени уже импортирован и разобран
 * движком (`LibrarySource.importTemplate`) — генерация получает его id. Ход прогона интерфейс
 * показывает по событиям `JobEvent`, тем же, что приходят по SSE.
 *
 * План колоды строится один раз, и из него собираются все три варианта вёрстки: поэтому
 * результат — три колоды одного содержания.
 */

/** Варианты вёрстки в порядке контракта: от плотного к воздушному. */
export const LAYOUT_VARIANTS: readonly LayoutVariant[] = layoutVariantSchema.options;

/** Бюджет на колоду из ТЗ: от загрузки до трёх готовых вариантов. */
export const GENERATION_BUDGET_MS = 5 * 60 * 1000;

const slideCountSchema = runConfigSchema.shape.slideCount;

/** Сколько слайдов можно попросить. Границы — из контракта прогона, а не из интерфейса. */
export const SLIDE_COUNT_RANGE = {
  min: slideCountSchema.minValue ?? 1,
  max: slideCountSchema.maxValue ?? 15,
} as const;

export interface GenerationRequest {
  /** Шаблон библиотеки, которым оформить колоду. Его профиль уже извлечён при импорте. */
  readonly templateId: string;
  /** Проект, в который попадёт колода; null — вне проектов. */
  readonly projectId: string | null;
  /** Бриф или готовый текст, как его ввёл человек. Может быть пустым, если есть файлы. */
  readonly brief: string;
  /** Материалы контент-пака. Разбирает их сервер, интерфейс только проверяет тип. */
  readonly files: readonly File[];
  /** Материалы, уже отправленные на сервер раньше, — например, в сохранённом разговоре. */
  readonly contentIds?: readonly string[];
  /** Желаемое число слайдов; null — сколько потребует материал. */
  readonly slideCount: number | null;
  /**
   * Модель, которая пишет текст, — из подключений в настройках. null — какую назначили роли
   * `writer`; моделей нет вовсе — решает сервер.
   */
  readonly model: ModelRef | null;
}

/**
 * Слайд, свёрстанный до конца прогона, — чтобы редактор показывал колоду по мере вёрстки.
 * Это канал фронта, а не событие `JobEvent`: в контракте события «слайд готов» пока нет, и
 * настоящий клиент API заполнит канал, когда оно появится. Слайды одного варианта вёрстки.
 */
export interface StreamedSlide {
  readonly index: number;
  readonly total: number;
  readonly slide: SlideIr;
  readonly designSystem: DesignSystem;
}

/** Один вариант вёрстки готовой колоды: то, что нужно для превью и перехода в редактор. */
export interface GeneratedVariant {
  readonly variant: LayoutVariant;
  readonly deckId: string;
  readonly title: string;
  readonly slideCount: number;
  /** Первый слайд: по нему рисуется обложка карточки. */
  readonly cover: SlideIr;
  /** Реальный PNG первого слайда из движка, если его сохранил API. */
  readonly coverPreviewUrl?: string;
  /** Профиль шаблона, которым нарисована обложка. */
  readonly designSystem: DesignSystem;
}

export interface GenerationResult {
  /** По одному на каждый вариант вёрстки, в порядке `LAYOUT_VARIANTS`. */
  readonly variants: readonly GeneratedVariant[];
  /**
   * Колоды собраны не на выбранном шаблоне. Так честно отвечает демо-источник на только что
   * загруженный шаблон: без движка колоду на нём не собрать, и он берёт готовую демо-колоду.
   */
  readonly templateSubstituted: boolean;
}

/**
 * Прогон на сервере. Его запоминает разговор: после обновления страницы сборку досматривают по
 * нему (`DeckGenerator.follow`), а не запускают заново.
 */
export interface ServerRun {
  /** Прогон, по событиям которого идёт ход сборки. */
  readonly runId: string;
  /** Все варианты вёрстки этой сборки, включая `runId`. */
  readonly variantRunIds: readonly string[];
  /** Имена вариантов вёрстки для тех же прогонов, когда их знает источник. */
  readonly variants?: readonly { readonly variant: string; readonly runId: string }[];
}

export interface DeckGenerator {
  /**
   * Умеет ли источник извлечь профиль из загруженного файла. Демо-источник не умеет, и интерфейс
   * предупреждает об этом до запуска, а не после.
   */
  readonly profilesUploadedTemplates: boolean;
  /**
   * Запустить генерацию. События приходят в `onEvent` по порядку `seq`. Отмена через `signal`
   * отклоняет обещание ошибкой `AbortError`; сбой сообщает событие `failed`, а затем отказ.
   * Свёрстанные слайды, если источник умеет их отдавать, приходят в `onSlide` по порядку.
   * Прогон, который принял сервер, приходит в `onServerRun`, как только он известен.
   */
  generate(
    request: GenerationRequest,
    onEvent: (event: JobEvent) => void,
    signal: AbortSignal,
    onSlide?: (slide: StreamedSlide) => void,
    onServerRun?: (run: ServerRun) => void,
  ): Promise<GenerationResult>;
  /**
   * Досмотреть прогон, запущенный раньше, — например, до обновления страницы. События приходят
   * с начала прогона, так что ход восстанавливается целиком. Источник без сервера этого не умеет.
   */
  follow?(
    run: ServerRun,
    onEvent: (event: JobEvent) => void,
    signal: AbortSignal,
    onSlide?: (slide: StreamedSlide) => void,
  ): Promise<GenerationResult>;
}

/**
 * Этапы, которые пройдёт прогон. Разбора шаблона среди них нет: профиль извлекается один раз
 * при импорте и кешируется. Экспорта тоже нет: результат — колоды для редактора, файлы
 * собираются потом, по запросу.
 */
export function plannedStages(): readonly JobStage[] {
  return ['queued', 'planning', 'laying-out', 'rendering', 'auditing'];
}

// Файлы

/** Расширение имени файла в нижнем регистре, с точкой; без расширения — пустая строка. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot).toLowerCase();
}

/** Что движок принимает как шаблон: презентация и шаблон PowerPoint. */
export const TEMPLATE_EXTENSIONS = ['.pptx', '.potx'] as const;

export type TemplateFileProblem = 'type' | 'empty';

/** Почему файл не годится в шаблоны; null — годится. Содержимое проверит движок. */
export function templateFileProblem(file: Pick<File, 'name' | 'size'>): TemplateFileProblem | null {
  if (!(TEMPLATE_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) return 'type';
  if (file.size === 0) return 'empty';
  return null;
}

/**
 * Какие файлы годятся в контент-пак и чем они станут в нём (`ContentItemKind`). Картинок нет:
 * элемент пака — текст, из которого можно взять цитату. Бриф и ссылка файлами не бывают.
 */
export const CONTENT_FILE_KINDS: Readonly<Record<string, ContentItemKind>> = {
  '.txt': 'text',
  '.md': 'text',
  '.docx': 'text',
  '.pdf': 'text',
  '.csv': 'table',
  '.tsv': 'table',
  '.xlsx': 'table',
};

/** Значение `accept` для выбора файлов контента. */
export const CONTENT_FILE_ACCEPT = Object.keys(CONTENT_FILE_KINDS).join(',');

/** Чем файл станет в контент-паке; null — такой файл не принимается. */
export function contentFileKind(fileName: string): ContentItemKind | null {
  return CONTENT_FILE_KINDS[extensionOf(fileName)] ?? null;
}

/** Файлы, добавленные к уже прикреплённым: что взято и имена того, что не подошло. */
export interface ContentFilesUpdate {
  readonly files: readonly File[];
  readonly rejected: readonly string[];
}

/**
 * Добавить файлы к контенту. Чужой тип и пустой файл не берутся — их имена уходят в `rejected`.
 * Тот же файл второй раз не прикрепляется: его узнают по имени, размеру и времени правки.
 */
export function addContentFiles(
  current: readonly File[],
  added: readonly File[],
): ContentFilesUpdate {
  const accepted = added.filter((file) => contentFileKind(file.name) !== null && file.size > 0);
  const same = (a: File, b: File) =>
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  return {
    files: [...current, ...accepted.filter((file) => !current.some((had) => same(had, file)))],
    rejected: added.filter((file) => !accepted.includes(file)).map((file) => file.name),
  };
}

/** Бриф из одних пробелов — не контент. Файлы уже прошли проверку типа. */
export function hasContent(brief: string, files: readonly unknown[]): boolean {
  return brief.trim() !== '' || files.length > 0;
}

// Ход прогона

export type GenerationStageState = 'pending' | 'running' | 'done' | 'failed';

export interface GenerationStage {
  readonly stage: JobStage;
  readonly state: GenerationStageState;
  /** Сколько единиц готово на этапе, если сервер это сообщил. */
  readonly done: number | null;
  readonly total: number | null;
  /** Чем этап занят прямо сейчас; пустая строка — сказать нечего. */
  readonly note: string;
}

export interface GenerationFailure {
  /** На каком этапе остановились; null — сбой без события `failed`, например обрыв связи. */
  readonly stage: JobStage | null;
  readonly code: JobErrorCode;
  /** Написано для человека. Пустая строка — сервер ничего не сказал. */
  readonly message: string;
  readonly retryable: boolean;
}

export interface GenerationWarning {
  readonly stage: JobStage;
  readonly code: string;
  readonly message: string;
}

export interface GenerationProgress {
  readonly stages: readonly GenerationStage[];
  /** От 0 до 100. Этапы весят поровну, текущий — по доле готовых единиц. */
  readonly percent: number;
  readonly finished: boolean;
  readonly failure: GenerationFailure | null;
  readonly warnings: readonly GenerationWarning[];
  /** Варианты, превью которых уже готово: их можно показать до конца прогона. */
  readonly previewed: readonly LayoutVariant[];
  /** Последний учтённый `seq`; -1 — событий ещё не было. */
  readonly lastSeq: number;
}

/** Ход прогона до первого события: все запланированные этапы ждут. */
export function initialProgress(planned: readonly JobStage[]): GenerationProgress {
  return {
    stages: planned.map(pendingStage),
    percent: 0,
    finished: false,
    failure: null,
    warnings: [],
    previewed: [],
    lastSeq: -1,
  };
}

/**
 * Одно событие поверх хода прогона — редьюсер, чистая функция. Событие с уже виденным `seq`
 * пропускается: после переподключения сервер может повторить хвост. Этап, о котором заранее не
 * знали, но сервер о нём сообщил, добавляется в конец: прогресс показывает то, что происходит,
 * а не то, что ждали.
 */
export function applyEvent(progress: GenerationProgress, event: JobEvent): GenerationProgress {
  if (event.seq <= progress.lastSeq) return progress;
  const next = { ...progress, lastSeq: event.seq };

  switch (event.type) {
    case 'stage-started':
      return withStages(
        next,
        updateStage(next.stages, event.stage, (stage) => ({ ...stage, state: 'running' })),
      );
    case 'stage-progress':
      return withStages(
        next,
        updateStage(next.stages, event.stage, (stage) => ({
          ...stage,
          state: stage.state === 'pending' ? 'running' : stage.state,
          done: Math.min(event.done, event.total),
          total: event.total,
          note: event.note,
        })),
      );
    case 'stage-finished':
      return withStages(
        next,
        updateStage(next.stages, event.stage, (stage) => ({
          ...stage,
          state: 'done',
          done: stage.total ?? stage.done,
          note: '',
        })),
      );
    case 'artifact-ready':
      if (event.kind !== 'preview' || event.variant === null) return next;
      if (next.previewed.includes(event.variant)) return next;
      return { ...next, previewed: [...next.previewed, event.variant] };
    case 'warning':
      return {
        ...next,
        warnings: [
          ...next.warnings,
          { stage: event.stage, code: event.code, message: event.message },
        ],
      };
    case 'failed':
      return withStages(
        {
          ...next,
          failure: {
            stage: event.stage,
            code: event.code,
            message: event.message,
            retryable: event.retryable,
          },
        },
        updateStage(next.stages, event.stage, (stage) => ({ ...stage, state: 'failed' })),
      );
    case 'done':
      return {
        ...next,
        finished: true,
        percent: 100,
        stages: next.stages.map((stage) => ({ ...stage, state: 'done', note: '' })),
      };
    default:
      return next;
  }
}

/** Ход прогона по всем событиям сразу — та же свёртка, что идёт по одному событию. */
export function generationProgress(
  planned: readonly JobStage[],
  events: readonly JobEvent[],
): GenerationProgress {
  return events.reduce(applyEvent, initialProgress(planned));
}

function pendingStage(stage: JobStage): GenerationStage {
  return { stage, state: 'pending', done: null, total: null, note: '' };
}

function updateStage(
  stages: readonly GenerationStage[],
  stage: JobStage,
  change: (current: GenerationStage) => GenerationStage,
): readonly GenerationStage[] {
  const index = stages.findIndex((item) => item.stage === stage);
  const current = stages[index];
  if (current === undefined) return [...stages, change(pendingStage(stage))];
  return stages.map((item, at) => (at === index ? change(current) : item));
}

function withStages(
  progress: GenerationProgress,
  stages: readonly GenerationStage[],
): GenerationProgress {
  return { ...progress, stages, percent: percentOf(stages, progress.finished) };
}

function percentOf(stages: readonly GenerationStage[], finished: boolean): number {
  if (finished) return 100;
  if (stages.length === 0) return 0;
  const share = stages.reduce((sum, stage) => {
    if (stage.state === 'done') return sum + 1;
    if (stage.state !== 'pending' && stage.total) return sum + (stage.done ?? 0) / stage.total;
    return sum;
  }, 0);
  // Не 100, пока сервер не сказал `done`: последний этап может быть длинным.
  return Math.min(99, Math.floor((share / stages.length) * 100));
}
