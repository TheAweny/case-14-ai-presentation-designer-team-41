import {
  applyEvent,
  initialProgress,
  plannedStages,
  type DeckGenerator,
  type GenerationFailure,
  type GenerationProgress,
  type GenerationRequest,
  type GenerationResult,
  type StreamedSlide,
} from './deck-generator';

/**
 * Прогоны генерации, запущенные из поля ввода. Поле запускает прогон и сразу уходит на его
 * страницу, поэтому прогон живёт не в компоненте, а здесь: переход между страницами его не
 * обрывает, а файлы из вложений не нужно никуда перекладывать.
 *
 * Прогон живёт в памяти вкладки. Обновили страницу — прогона нет, и страница честно говорит
 * об этом. Когда за генератором встанет API, прогон переживёт и это: у сервера будет свой
 * `runId`, и события можно будет дочитать с последнего `seq`.
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
}

export interface GenerationRuns {
  /** Запустить прогон. Отдаёт его id — по нему открывается страница прогона. */
  start(request: GenerationRequest, returnHref: string): string;
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

  const launch = (runId: string) => {
    const run = runs.get(runId);
    if (!run) return;
    const controller = new AbortController();
    controllers.set(runId, controller);
    const current = () => controllers.get(runId) === controller;
    generator
      .generate(
        run.request,
        (event) => {
          if (!current()) return;
          update(runId, ({ progress }) => {
            const next = applyEvent(progress, event);
            return next.failure
              ? { progress: next, phase: 'failed', failure: next.failure }
              : { progress: next };
          });
        },
        controller.signal,
        (slide) => {
          if (!current()) return;
          update(runId, ({ slides }) => ({ slides: [...slides, slide] }));
        },
      )
      .then((result) => {
        if (!current()) return;
        controllers.delete(runId);
        update(runId, () => ({ phase: 'done', result }));
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        controllers.delete(runId);
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // Сервер уже назвал причину событием `failed` — она важнее общей ошибки клиента.
        update(runId, ({ failure }) => ({ phase: 'failed', failure: failure ?? UNKNOWN_FAILURE }));
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
      });
      for (const listener of listeners) listener();
      launch(runId);
      return runId;
    },
    get: (runId) => runs.get(runId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel(runId) {
      if (runs.get(runId)?.phase !== 'running') return;
      stop(runId);
      update(runId, () => ({ phase: 'cancelled' }));
    },
    retry(runId) {
      stop(runId);
      update(runId, () => ({
        phase: 'running',
        progress: initialProgress(plannedStages()),
        slides: [],
        result: null,
        failure: null,
      }));
      launch(runId);
    },
  };
}
