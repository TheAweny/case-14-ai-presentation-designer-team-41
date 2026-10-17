import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import { createDemoGenerator } from '../mocks/demo-generator';
import { createDemoLibrary, createDemoLibrarySource } from '../mocks/demo-library';
import type { DeckGenerator, GenerationRequest, GenerationResult } from './deck-generator';
import { createGenerationRuns } from './generation-runs';

const request: GenerationRequest = {
  templateId: 'warm-16x9',
  projectId: 'sales',
  brief: 'Итоги квартала для правления',
  files: [new File(['Выручка,100'], 'выручка.csv')],
  slideCount: null,
  model: null,
};

const ids = () => {
  let next = 0;
  return () => `run-${(next += 1)}`;
};

const demo = () => createDemoGenerator({ library: createDemoLibrarySource(), stepMs: 10 });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>;

function event(seq: number, draft: Draft): JobEvent {
  return { ...draft, schemaVersion: 1, runId: 'run', seq, at: '2026-09-25T09:00:00Z' } as JobEvent;
}

const RESULT: GenerationResult = { variants: [], templateSubstituted: false };

function states(
  run:
    | {
        readonly progress: {
          readonly stages: readonly { readonly stage: string; readonly state: string }[];
        };
      }
    | undefined,
) {
  if (!run) throw new Error('Прогон не найден');
  return run.progress.stages.map((stage) => [stage.stage, stage.state]);
}

describe('createGenerationRuns', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('прогон доходит до вариантов, запрос с файлами остаётся при нём', async () => {
    const runs = createGenerationRuns(demo(), ids());
    const runId = runs.start(request, '/projects/sales');
    expect(runs.get(runId)?.phase).toBe('running');
    await vi.runAllTimersAsync();
    const run = runs.get(runId);
    expect(run?.phase).toBe('done');
    expect(run?.result?.variants).toHaveLength(3);
    expect(run?.progress.finished).toBe(true);
    expect(run?.request.files[0]?.name).toBe('выручка.csv');
    expect(run?.returnHref).toBe('/projects/sales');
  });

  it('сообщает подписчикам о каждом изменении и меняет снимок целиком', async () => {
    const runs = createGenerationRuns(demo(), ids());
    const listener = vi.fn();
    runs.subscribe(listener);
    const runId = runs.start(request, '/');
    const first = runs.get(runId);
    await vi.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalled();
    expect(runs.get(runId)).not.toBe(first);
  });

  it('отмена останавливает прогон, повтор запускает его заново под тем же id', async () => {
    const runs = createGenerationRuns(demo(), ids());
    const runId = runs.start(request, '/');
    await vi.advanceTimersByTimeAsync(30);
    runs.cancel(runId);
    expect(runs.get(runId)?.phase).toBe('cancelled');
    const seq = runs.get(runId)?.progress.lastSeq;
    await vi.runAllTimersAsync();
    // После отмены события не приходят.
    expect(runs.get(runId)?.progress.lastSeq).toBe(seq);

    runs.retry(runId);
    expect(runs.get(runId)?.phase).toBe('running');
    await vi.runAllTimersAsync();
    expect(runs.get(runId)?.phase).toBe('done');
  });

  it('копит свёрстанные слайды по порядку, повтор начинает их заново', async () => {
    const { library, decks } = createDemoLibrary();
    const runs = createGenerationRuns(createDemoGenerator({ library, decks, stepMs: 10 }), ids());
    const runId = runs.start(request, '/');
    await vi.runAllTimersAsync();
    const slides = runs.get(runId)?.slides ?? [];
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.map((item) => item.index)).toEqual(slides.map((_, index) => index));
    runs.retry(runId);
    expect(runs.get(runId)?.slides).toEqual([]);
  });

  it('сбой генератора — ошибка, которую можно повторить', async () => {
    const broken: DeckGenerator = {
      profilesUploadedTemplates: false,
      generate: () => Promise.reject(new Error('network')),
    };
    const runs = createGenerationRuns(broken, ids());
    const runId = runs.start(request, '/');
    await vi.runAllTimersAsync();
    expect(runs.get(runId)?.phase).toBe('failed');
    expect(runs.get(runId)?.failure?.retryable).toBe(true);
  });

  it('неизвестный прогон — undefined', () => {
    expect(createGenerationRuns(demo(), ids()).get('nope')).toBeUndefined();
  });

  it('успех без события done закрывает идущий этап и пропускает будущие', async () => {
    const generator: DeckGenerator = {
      profilesUploadedTemplates: false,
      generate(_request, onEvent) {
        onEvent(event(0, { type: 'stage-finished', stage: 'planning', durationMs: 1 }));
        onEvent(event(1, { type: 'stage-started', stage: 'laying-out' }));
        return Promise.resolve(RESULT);
      },
    };
    const runs = createGenerationRuns(generator, ids(), () => 50);
    const runId = runs.start(request, '/');
    await vi.advanceTimersByTimeAsync(0);
    const run = runs.get(runId);
    expect(run?.phase).toBe('done');
    expect(run?.result).toBe(RESULT);
    expect(run?.finishedAt).toBe(50);
    expect(run?.progress).toMatchObject({ finished: true, percent: 100 });
    expect(states(run)).toEqual([
      ['planning', 'done'],
      ['laying-out', 'done'],
      ['rendering', 'skipped'],
      ['auditing', 'skipped'],
      ['exporting', 'skipped'],
    ]);
  });

  it('поздний успех после отмены не закрывает ход и не пропускает будущие этапы', async () => {
    let finish!: (result: GenerationResult) => void;
    const generator: DeckGenerator = {
      profilesUploadedTemplates: false,
      generate(_request, onEvent) {
        onEvent(event(0, { type: 'stage-started', stage: 'planning' }));
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    };
    const runs = createGenerationRuns(generator, ids(), () => 20);
    const runId = runs.start(request, '/');
    runs.cancel(runId);
    const cancelled = runs.get(runId);
    finish(RESULT);
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.get(runId)).toBe(cancelled);
    expect(cancelled?.phase).toBe('cancelled');
    expect(cancelled?.result).toBeNull();
    expect(cancelled?.progress.finished).toBe(false);
    expect(states(cancelled)).toEqual([
      ['planning', 'running'],
      ['laying-out', 'pending'],
      ['rendering', 'pending'],
      ['auditing', 'pending'],
      ['exporting', 'pending'],
    ]);
  });

  it('сбой оставляет будущие этапы в ожидании', async () => {
    const generator: DeckGenerator = {
      profilesUploadedTemplates: false,
      generate(_request, onEvent) {
        onEvent(event(0, { type: 'stage-finished', stage: 'planning', durationMs: 1 }));
        onEvent(event(1, { type: 'stage-started', stage: 'laying-out' }));
        onEvent(
          event(2, {
            type: 'failed',
            stage: 'laying-out',
            code: 'engine-failed',
            message: 'Сборка остановилась',
            retryable: true,
          }),
        );
        return Promise.reject(new Error('engine-failed'));
      },
    };
    const runs = createGenerationRuns(generator, ids(), () => 30);
    const runId = runs.start(request, '/');
    await vi.advanceTimersByTimeAsync(0);
    const run = runs.get(runId);
    expect(run?.phase).toBe('failed');
    expect(run?.failure).toMatchObject({ stage: 'laying-out', code: 'engine-failed' });
    expect(run?.progress.finished).toBe(false);
    expect(run?.progress.percent).not.toBe(100);
    expect(states(run)).toEqual([
      ['planning', 'done'],
      ['laying-out', 'failed'],
      ['rendering', 'pending'],
      ['auditing', 'pending'],
      ['exporting', 'pending'],
    ]);
  });
});

describe('прогон на сервере', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const SERVER = { runId: 'srv-1', variantRunIds: ['srv-1'] };

  it('запоминает прогон, который принял сервер; повтор начинает без него', async () => {
    const generator = demo();
    const runs = createGenerationRuns(
      {
        ...generator,
        generate(next, onEvent, signal, onSlide, onServerRun) {
          onServerRun?.(SERVER);
          return generator.generate(next, onEvent, signal, onSlide);
        },
      },
      ids(),
    );
    const runId = runs.start(request, '/');
    expect(runs.get(runId)?.server).toEqual(SERVER);
    runs.cancel(runId);
    runs.retry(runId);
    // Повтор — новый прогон на сервере: его имя придёт снова.
    expect(runs.get(runId)?.server).toEqual(SERVER);
  });

  it('досматривает прогон сервера под прежним id и с прежним началом', async () => {
    const generator = demo();
    const follow = vi.fn<NonNullable<DeckGenerator['follow']>>((_run, onEvent, signal, onSlide) =>
      generator.generate(request, onEvent, signal, onSlide),
    );
    const runs = createGenerationRuns({ ...generator, follow }, ids());
    const plan = { request, returnHref: '/', server: SERVER, startedAt: 1000 };
    runs.follow('run-old', plan);
    runs.follow('run-old', plan);
    expect(runs.get('run-old')).toMatchObject({ phase: 'running', startedAt: 1000 });
    await vi.runAllTimersAsync();
    expect(follow).toHaveBeenCalledTimes(1);
    expect(runs.get('run-old')?.phase).toBe('done');
  });

  it('follow без события done закрывает идущий этап и пропускает будущие', async () => {
    const followRun = vi.fn<NonNullable<DeckGenerator['follow']>>((_run, onEvent) => {
      onEvent(event(0, { type: 'stage-finished', stage: 'planning', durationMs: 1 }));
      onEvent(event(1, { type: 'stage-started', stage: 'laying-out' }));
      return Promise.resolve(RESULT);
    });
    const runs = createGenerationRuns(
      {
        profilesUploadedTemplates: false,
        generate: () => Promise.reject(new Error('generate')),
        follow: followRun,
      },
      ids(),
      () => 70,
    );
    runs.follow('run-http', { request, returnHref: '/', server: SERVER, startedAt: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const run = runs.get('run-http');
    expect(followRun).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({
      phase: 'done',
      result: RESULT,
      startedAt: 1000,
      finishedAt: 70,
      progress: { finished: true, percent: 100 },
    });
    expect(states(run)).toEqual([
      ['planning', 'done'],
      ['laying-out', 'done'],
      ['rendering', 'skipped'],
      ['auditing', 'skipped'],
      ['exporting', 'skipped'],
    ]);
  });

  it('генератор без сервера досмотреть не может — прогон с ошибкой, её можно повторить', async () => {
    const runs = createGenerationRuns(demo(), ids());
    runs.follow('run-old', { request, returnHref: '/', server: SERVER, startedAt: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(runs.get('run-old')).toMatchObject({ phase: 'failed', failure: { retryable: true } });
  });
});
