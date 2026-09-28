import type { JobEvent, JobStage } from '@lct/contracts';
import type { TemplateSummary } from '../lib/library-source';
import { importStages, type TemplateImporter } from '../lib/template-importer';

/**
 * Сколько единиц работы демо показывает на каждом этапе. Настоящий движок сообщит свои — части
 * файла и макеты; демо файла не читает, и число здесь только даёт полосе прогресса шаги.
 */
const DEMO_UNITS: Readonly<Partial<Record<JobStage, number>>> = {
  'parsing-template': 3,
  'profiling-template': 2,
};

/**
 * Импорт шаблона без движка: проигрывает те же события, что пришлёт API, по таймеру, и в конце
 * регистрирует шаблон функцией `register`. Профиль из файла демо не извлекает и не делает вид,
 * что извлёк: `register` берёт демо-профиль (`LibrarySource.importTemplate`), а
 * `profilesFiles: false` даёт интерфейсу сказать об этом заранее.
 *
 * `register` — граница с библиотекой: в тестах это демо-источник напрямую, во вкладке —
 * серверное действие, чтобы новый шаблон увидели серверные страницы. Её отказ — отказ импорта,
 * без события `failed`: причину демо не знает, и хранилище импортов считает сбой повторяемым.
 */
export function createDemoTemplateImporter({
  register,
  stepMs = 180,
  profilesFiles = false,
}: {
  register: (file: File) => Promise<TemplateSummary>;
  stepMs?: number;
  profilesFiles?: boolean;
}): TemplateImporter {
  let runs = 0;
  return {
    profilesFiles,
    async import(file, onEvent, signal) {
      runs += 1;
      const events = scriptFor(`demo-import-${runs}`);
      // Регистрация — перед последним этапом завершения: профиль «извлечён», шаблон записан.
      const beforeFinish = events.findIndex(
        (event) => event.type === 'stage-finished' && event.stage === 'profiling-template',
      );
      await play(events.slice(0, beforeFinish), onEvent, signal, stepMs);
      const template = await register(file);
      if (signal.aborted) throw cancelled();
      await play(events.slice(beforeFinish), onEvent, signal, stepMs);
      return template;
    },
  };
}

function cancelled(): DOMException {
  return new DOMException('Template import cancelled', 'AbortError');
}

/** События по таймеру, по одному за шаг. Отмена останавливает их и отклоняет обещание. */
function play(
  events: readonly JobEvent[],
  onEvent: (event: JobEvent) => void,
  signal: AbortSignal,
  stepMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let at = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(cancelled());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });

    const tick = () => {
      const event = events[at];
      at += 1;
      if (!event) {
        signal.removeEventListener('abort', abort);
        resolve();
        return;
      }
      onEvent(event);
      timer = setTimeout(tick, stepMs);
    };
    timer = setTimeout(tick, stepMs);
  });
}

/** Весь сценарий импорта заранее: этапы по порядку, в каждом — прогресс по единицам, в конце `done`. */
function scriptFor(runId: string): JobEvent[] {
  const events: JobEvent[] = [];
  const started = Date.now();
  const push = (event: DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>) => {
    const seq = events.length;
    events.push({
      ...event,
      schemaVersion: 1,
      runId,
      seq,
      at: new Date(started + seq * 100).toISOString(),
    } as JobEvent);
  };

  for (const stage of importStages()) {
    push({ type: 'stage-started', stage });
    const total = DEMO_UNITS[stage] ?? 1;
    for (let done = 1; done <= total; done += 1) {
      push({ type: 'stage-progress', stage, done, total, note: '' });
    }
    push({ type: 'stage-finished', stage, durationMs: total * 100 });
  }
  push({ type: 'artifact-ready', kind: 'manifest', variant: null, path: 'manifest.json' });
  push({ type: 'done', totalMs: events.length * 100, manifestPath: 'manifest.json' });
  return events;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
