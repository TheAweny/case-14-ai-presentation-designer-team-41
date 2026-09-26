import type {
  DesignSystem,
  JobErrorCode,
  JobEvent,
  JobStage,
  LayoutVariantName,
  SlideIr,
} from '@lct/contracts';

/**
 * Экспорт колоды. Редактор знает только интерфейс `DeckExporter`: сейчас за ним демо-источник,
 * потом HTTP-клиент API. Сам файл собирает движок — в TypeScript работы с .pptx нет, — а
 * редактор отдаёт ему отредактированные слайды и показывает ход работы по событиям `JobEvent`,
 * тем же, что приходят по SSE во время прогона.
 */

export const EXPORT_FORMATS = ['pptx', 'pdf', 'png', 'html'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Расширение готового файла. PNG приходят архивом: слайдов несколько. */
export const EXPORT_EXTENSION: Readonly<Record<ExportFormat, string>> = {
  pptx: '.pptx',
  pdf: '.pdf',
  png: '.zip',
  html: '.html',
};

export interface ExportRequest {
  readonly deckId: string;
  /** Имя файла без расширения. */
  readonly fileName: string;
  readonly format: ExportFormat;
  readonly variant: LayoutVariantName;
  /** Уже отобранные слайды, в порядке показа. */
  readonly slides: readonly SlideIr[];
  readonly designSystem: DesignSystem;
  /** Прогнать аудит перед сборкой файла. */
  readonly audit: boolean;
}

export interface ExportResult {
  /** С расширением. */
  readonly fileName: string;
  /** Откуда скачать файл. Null — файла нет: так отвечает демо-источник без сервера. */
  readonly url: string | null;
}

export interface DeckExporter {
  /**
   * Запустить экспорт. События приходят в `onEvent` по порядку `seq`. Отмена через `signal`
   * отклоняет обещание ошибкой `AbortError`; сбой сообщает событие `failed`, а затем отказ.
   */
  export(
    request: ExportRequest,
    onEvent: (event: JobEvent) => void,
    signal: AbortSignal,
  ): Promise<ExportResult>;
}

/** Этапы, которые экспорт пройдёт. Аудит — только если его попросили. */
export function plannedStages(request: Pick<ExportRequest, 'audit'>): readonly JobStage[] {
  return request.audit ? ['rendering', 'auditing', 'exporting'] : ['rendering', 'exporting'];
}

export type StageState = 'pending' | 'running' | 'done';

export interface StageProgress {
  readonly stage: JobStage;
  readonly state: StageState;
  /** Сколько единиц готово на этапе, если сервер это сообщил. */
  readonly done: number | null;
  readonly total: number | null;
}

export interface ExportFailure {
  readonly code: JobErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ExportProgress {
  readonly stages: readonly StageProgress[];
  /** От 0 до 100. Этапы весят поровну, текущий — по доле готовых единиц. */
  readonly percent: number;
  readonly finished: boolean;
  readonly failure: ExportFailure | null;
}

/**
 * Ход экспорта по событиям. Этап, о котором заранее не знали, но сервер о нём сообщил,
 * добавляется в конец списка: прогресс показывает то, что происходит, а не то, что ждали.
 */
export function exportProgress(
  planned: readonly JobStage[],
  events: readonly JobEvent[],
): ExportProgress {
  const order = [...planned];
  const state = new Map<JobStage, { state: StageState; done: number | null; total: number | null }>(
    planned.map((stage) => [stage, { state: 'pending', done: null, total: null }]),
  );
  let finished = false;
  let failure: ExportFailure | null = null;

  const entry = (stage: JobStage) => {
    let found = state.get(stage);
    if (!found) {
      found = { state: 'pending', done: null, total: null };
      state.set(stage, found);
      order.push(stage);
    }
    return found;
  };

  for (const event of events) {
    switch (event.type) {
      case 'stage-started':
        entry(event.stage).state = 'running';
        break;
      case 'stage-progress': {
        const current = entry(event.stage);
        if (current.state === 'pending') current.state = 'running';
        current.done = Math.min(event.done, event.total);
        current.total = event.total;
        break;
      }
      case 'stage-finished': {
        const current = entry(event.stage);
        current.state = 'done';
        if (current.total !== null) current.done = current.total;
        break;
      }
      case 'failed':
        failure = { code: event.code, message: event.message, retryable: event.retryable };
        break;
      case 'done':
        finished = true;
        break;
      default:
        break;
    }
  }

  const stages = order.map((stage) => {
    const current = entry(stage);
    return {
      stage,
      state: finished ? 'done' : current.state,
      done: current.done,
      total: current.total,
    } satisfies StageProgress;
  });
  return { stages, percent: percentOf(stages, finished), finished, failure };
}

function percentOf(stages: readonly StageProgress[], finished: boolean): number {
  if (finished) return 100;
  if (stages.length === 0) return 0;
  const share = stages.reduce((sum, stage) => {
    if (stage.state === 'done') return sum + 1;
    if (stage.state === 'running' && stage.total) return sum + (stage.done ?? 0) / stage.total;
    return sum;
  }, 0);
  // Не 100, пока сервер не сказал `done`: последний этап может быть длинным.
  return Math.min(99, Math.floor((share / stages.length) * 100));
}

const FORBIDDEN_IN_FILE_NAME = '<>:"/\\|?*';

/**
 * Имя файла из названия колоды: без символов, которые файловые системы не принимают, без
 * пробелов по краям. Пустое имя заменяется запасным.
 */
/** Имя с датой в конце — `Отчёт 2026-09-26`: по нему файлы разных дней не путаются. */
export function datedFileName(name: string, date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${name} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function safeFileName(title: string, fallback: string): string {
  const cleaned = Array.from(title, (char) =>
    char.charCodeAt(0) < 32 || FORBIDDEN_IN_FILE_NAME.includes(char) ? ' ' : char,
  )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned === '' ? fallback : cleaned.slice(0, 120);
}
