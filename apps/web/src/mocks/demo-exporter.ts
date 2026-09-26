import type { JobEvent, JobStage } from '@lct/contracts';
import {
  EXPORT_EXTENSION,
  plannedStages,
  type DeckExporter,
  type ExportFormat,
  type ExportRequest,
} from '../lib/deck-export';

/** Какой артефакт `JobEvent` сообщает о готовом файле. PNG контракт называет превью. */
const ARTIFACT_KIND: Readonly<Record<ExportFormat, 'pptx' | 'pdf' | 'preview' | 'html'>> = {
  pptx: 'pptx',
  pdf: 'pdf',
  png: 'preview',
  html: 'html',
};

/**
 * Экспорт без сервера: проигрывает те же события, что пришлёт API, в том же порядке, и
 * отвечает, что файла нет (`url: null`). Интерфейс так проверяется целиком, а человек видит
 * честное «файл не создан», а не выдуманный документ.
 */
export function createDemoExporter({ stepMs = 120 }: { stepMs?: number } = {}): DeckExporter {
  let runs = 0;
  return {
    export(request, onEvent, signal) {
      runs += 1;
      const runId = `demo-export-${runs}`;
      return new Promise((resolve, reject) => {
        const script = eventsFor(request, runId);
        let at = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const abort = () => {
          if (timer !== undefined) clearTimeout(timer);
          reject(new DOMException('Export cancelled', 'AbortError'));
        };
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });

        const tick = () => {
          const event = script[at];
          at += 1;
          if (!event) {
            signal.removeEventListener('abort', abort);
            resolve({ fileName: request.fileName + EXPORT_EXTENSION[request.format], url: null });
            return;
          }
          onEvent(event);
          timer = setTimeout(tick, stepMs);
        };
        timer = setTimeout(tick, stepMs);
      });
    },
  };
}

/** Весь сценарий экспорта заранее: события — факты о прошлом, их порядок не меняется. */
export function eventsFor(request: ExportRequest, runId: string): JobEvent[] {
  const events: JobEvent[] = [];
  const started = Date.now();
  const push = (event: DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>) => {
    events.push({
      ...event,
      schemaVersion: 1,
      runId,
      seq: events.length,
      at: new Date(started + events.length * 100).toISOString(),
    } as JobEvent);
  };
  const slides = Math.max(1, request.slides.length);
  const unitsOf = (stage: JobStage) => (stage === 'exporting' ? 1 : slides);

  for (const stage of plannedStages(request)) {
    push({ type: 'stage-started', stage });
    const total = unitsOf(stage);
    for (let done = 1; done <= total; done += 1) {
      push({ type: 'stage-progress', stage, done, total, note: '' });
    }
    push({ type: 'stage-finished', stage, durationMs: total * 100 });
  }
  push({
    type: 'artifact-ready',
    kind: ARTIFACT_KIND[request.format],
    variant: request.variant,
    path: `export/${request.fileName}${EXPORT_EXTENSION[request.format]}`,
  });
  push({ type: 'done', totalMs: events.length * 100, manifestPath: 'manifest.json' });
  return events;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
