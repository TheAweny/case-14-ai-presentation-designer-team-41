import type { JobEvent } from '@lct/contracts';
import {
  applyEvent,
  completeProgress,
  initialProgress,
  plannedStages,
  type DeckGenerator,
  type GenerationFailure,
  type GenerationProgress,
  type GenerationRequest,
  type GenerationResult,
  type ServerRun,
  type StreamedSlide,
} from './deck-generator';

/**
 * Прогоны генерации, запущенные из поля ввода. Поле запускает прогон и сразу уходит на его
 * страницу, поэтому прогон живёт не в компоненте, а здесь: переход между страницами его не
 * обрывает, а файлы из вложений не нужно никуда перекладывать.
 *
 * Прогон живёт в памяти вкладки. Обновили страницу — прогона во вкладке нет, но у сервера он
 * свой (`server`): разговор помнит его и досматривает сборку через `follow`.
 */

export type GenerationPhase = 'running' | 'done' | 'failed' | 'cancelled';

export interface GenerationRun {
  readonly runId: string;
  readonly request: GenerationRequest;
  /** Откуда запущен прогон: туда ведут «Отменить» и «Изменить запрос». */
  readonly returnHref: string;
  readonly phase: GenerationPhase;
  readonly progress: GenerationProgress;
  /** Слайды, свёрстанные до конца прогона, по порядку. Пусто, если источник их не отдаёт. */
  readonly slides: readonly StreamedSlide[];
  readonly result: GenerationResult | null;
  readonly failure: GenerationFailure | null;
  /** Когда прогон запущен (или запущен снова), мс эпохи: по нему идут часы в карточке хода. */
  readonly startedAt: number;
  /** Когда прогон закончился — готово, сбой или отмена; null — ещё идёт. */
  readonly finishedAt: number | null;
  /** Прогон на сервере; null — сервер его ещё не принял или генератор без сервера. */
  readonly server: ServerRun | null;
}

export interface GenerationRuns {
  /** Запустить прогон. Отдаёт его id — по нему открывается страница прогона. */
  start(request: GenerationRequest, returnHref: string): string;
  /**
   * Досмотреть прогон, который идёт на сервере, под его прежним id — после обновления страницы.
   * Прогон с таким id уже есть во вкладке — ничего не делает. `request` нужен для повтора.
   */
  follow(
    runId: string,
    run: {
      readonly request: GenerationRequest;
      readonly returnHref: string;
      readonly server: ServerRun;
      readonly startedAt: number;
    },
  ): void;
  get(runId: string): GenerationRun | undefined;
  /** Любое изменение любого прогона. Снимок прогона при изменении заменяется целиком. */
  subscribe(listener: () => void): () => void;
  cancel(runId: string): void;
  /** Запустить тот же запрос заново под тем же id. */
  retry(runId: string): void;
}

/** Сбой без события `failed`: обрыв сети, ошибка клиента. Его всегда можно повторить. */
const UNKNOWN_FAILURE: GenerationFailure = {
  stage: null,
  code: 'internal',
  message: '',
  retryable: true,
};

export function createGenerationRuns(
  generator: DeckGenerator,
  newRunId: () => string = () => crypto.randomUUID(),
  now: () => number = () => Date.now(),
): GenerationRuns {
  const runs = new Map<string, GenerationRun>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();

  const update = (runId: string, patch: (run: GenerationRun) => Partial<GenerationRun>) => {
    const run = runs.get(runId);
    if (!run) return;
    runs.set(runId, { ...run, ...patch(run) });
    for (const listener of listeners) listener();
  };

  /** Запустить запрос прогона или, с `resume`, досмотреть прогон, уже идущий на сервере. */
  const launch = (runId: string, resume?: ServerRun) => {
    const run = runs.get(runId);
    if (!run) return;
    const controller = new AbortController();
    controllers.set(runId, controller);
    const current = () => controllers.get(runId) === controller;
    const onEvent = (event: JobEvent) => {
      if (!current()) return;
      update(runId, ({ progress }) => {
        const next = applyEvent(progress, event);
        return next.failure
          ? { progress: next, phase: 'failed', failure: next.failure, finishedAt: now() }
          : { progress: next };
      });
    };
    const onSlide = (slide: StreamedSlide) => {
      if (!current()) return;
      update(runId, ({ slides }) => ({ slides: [...slides, slide] }));
    };
    const pending = resume
      ? generator.follow
        ? generator.follow(resume, onEvent, controller.signal, onSlide)
        : Promise.reject(new Error('This generator cannot follow a server run.'))
      : generator.generate(run.request, onEvent, controller.signal, onSlide, (server) => {
          if (current()) update(runId, () => ({ server }));
        });
    pending
      .then((result) => {
        if (!current()) return;
        controllers.delete(runId);
        // follow читает события раньше, чем status становится done, и события done может не быть.
        // Успешный результат сам закрывает ход. Ошибка и отмена этот путь не берут.
        update(runId, ({ progress }) => ({
          phase: 'done',
          result,
          finishedAt: now(),
          progress: completeProgress(progress),
        }));
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        controllers.delete(runId);
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // Сервер уже назвал причину событием `failed` — она важнее общей ошибки клиента. Нет
        // события — берём текст ошибки: например, API не запустил прогон, потому что модель не
        // настроена, и сказал это в ответе.
        update(runId, ({ failure, finishedAt }) => ({
          phase: 'failed',
          failure:
            failure ??
            (reason instanceof Error && reason.message
              ? { ...UNKNOWN_FAILURE, message: reason.message }
              : UNKNOWN_FAILURE),
          finishedAt: finishedAt ?? now(),
        }));
      });
  };

  const stop = (runId: string) => {
    controllers.get(runId)?.abort();
    controllers.delete(runId);
  };

  return {
    start(request, returnHref) {
      const runId = newRunId();
      runs.set(runId, {
        runId,
        request,
        returnHref,
        phase: 'running',
        progress: initialProgress(plannedStages()),
        slides: [],
        result: null,
        failure: null,
        startedAt: now(),
        finishedAt: null,
        server: null,
      });
      for (const listener of listeners) listener();
      launch(runId);
      return runId;
    },
    follow(runId, { request, returnHref, server, startedAt }) {
      if (runs.has(runId)) return;
      runs.set(runId, {
        runId,
        request,
        returnHref,
        phase: 'running',
        progress: initialProgress(plannedStages()),
        slides: [],
        result: null,
        failure: null,
        startedAt,
        finishedAt: null,
        server,
      });
      for (const listener of listeners) listener();
      launch(runId, server);
    },
    get: (runId) => runs.get(runId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel(runId) {
      if (runs.get(runId)?.phase !== 'running') return;
      stop(runId);
      update(runId, () => ({ phase: 'cancelled', finishedAt: now() }));
    },
    retry(runId) {
      stop(runId);
      update(runId, () => ({
        phase: 'running',
        progress: initialProgress(plannedStages()),
        slides: [],
        result: null,
        failure: null,
        startedAt: now(),
        finishedAt: null,
        server: null,
      }));
      launch(runId);
    },
  };
}
