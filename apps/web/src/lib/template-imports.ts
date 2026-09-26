import {
  applyEvent,
  initialProgress,
  templateFileProblem,
  type GenerationFailure,
  type GenerationProgress,
} from './deck-generator';
import { InvalidTemplateFileError, type TemplateSummary } from './library-source';
import { importStages, type TemplateImporter } from './template-importer';

/**
 * Импорты шаблонов, запущенные во вкладке. Импорт живёт не в компоненте, а здесь, как прогон
 * генерации (`generation-runs.ts`): его запускает карточка «Прикрепить шаблон» или агент в
 * разговоре, а смотреть за ходом может кто угодно по id — перерисовка страницы импорт не обрывает.
 *
 * Импорт живёт в памяти вкладки. Шаблон, который он успел зарегистрировать, остаётся в
 * библиотеке и после обновления страницы.
 */

export type TemplateImportPhase = 'running' | 'done' | 'failed';

export interface TemplateImport {
  readonly importId: string;
  /** Файл, который разбирается: его имя видно, пока импорт идёт, и с ним же работает повтор. */
  readonly file: File;
  readonly phase: TemplateImportPhase;
  /** Ход по этапам `importStages()`. */
  readonly progress: GenerationProgress;
  /** Зарегистрированный шаблон; до конца импорта — null. */
  readonly result: TemplateSummary | null;
  readonly failure: GenerationFailure | null;
}

export interface TemplateImports {
  /**
   * Начать импорт файла. Отдаёт id импорта. Негодный файл (`templateFileProblem`) импорта не
   * начинает: `InvalidTemplateFileError` — вызывающий проверяет файл заранее и объясняет сам.
   */
  start(file: File): string;
  get(importId: string): TemplateImport | undefined;
  /** Любое изменение любого импорта. Снимок импорта при изменении заменяется целиком. */
  subscribe(listener: () => void): () => void;
  /** Разобрать тот же файл заново под тем же id. Идущий импорт не трогает. */
  retry(importId: string): void;
}

/** Сбой без события `failed`: обрыв сети, отказ сервера. Его всегда можно повторить. */
const UNKNOWN_FAILURE: GenerationFailure = {
  stage: null,
  code: 'internal',
  message: '',
  retryable: true,
};

export function createTemplateImports(
  importer: TemplateImporter,
  newImportId: () => string = () => crypto.randomUUID(),
): TemplateImports {
  const imports = new Map<string, TemplateImport>();
  const controllers = new Map<string, AbortController>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const update = (importId: string, patch: (item: TemplateImport) => Partial<TemplateImport>) => {
    const item = imports.get(importId);
    if (!item) return;
    imports.set(importId, { ...item, ...patch(item) });
    notify();
  };

  const launch = (importId: string) => {
    const item = imports.get(importId);
    if (!item) return;
    const controller = new AbortController();
    controllers.set(importId, controller);
    const current = () => controllers.get(importId) === controller;
    importer
      .import(
        item.file,
        (event) => {
          if (!current()) return;
          update(importId, ({ progress }) => {
            const next = applyEvent(progress, event);
            return next.failure
              ? { progress: next, phase: 'failed', failure: next.failure }
              : { progress: next };
          });
        },
        controller.signal,
      )
      .then((result) => {
        if (!current()) return;
        controllers.delete(importId);
        update(importId, () => ({ phase: 'done', result }));
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        controllers.delete(importId);
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        // Сервер уже назвал причину событием `failed` — она важнее общей ошибки клиента.
        update(importId, ({ failure }) => ({
          phase: 'failed',
          failure: failure ?? UNKNOWN_FAILURE,
        }));
      });
  };

  const fresh = (): Pick<TemplateImport, 'phase' | 'progress' | 'result' | 'failure'> => ({
    phase: 'running',
    progress: initialProgress(importStages()),
    result: null,
    failure: null,
  });

  return {
    start(file) {
      const problem = templateFileProblem(file);
      if (problem) throw new InvalidTemplateFileError(problem);
      const importId = newImportId();
      imports.set(importId, { importId, file, ...fresh() });
      notify();
      launch(importId);
      return importId;
    },
    get: (importId) => imports.get(importId),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retry(importId) {
      if (imports.get(importId)?.phase !== 'failed') return;
      update(importId, fresh);
      launch(importId);
    },
  };
}
