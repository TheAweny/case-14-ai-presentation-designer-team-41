import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoGenerator } from '../mocks/demo-generator';
import { createDemoLibrary, createDemoLibrarySource } from '../mocks/demo-library';
import type { DeckGenerator, GenerationRequest } from './deck-generator';
import { createGenerationRuns } from './generation-runs';

const request: GenerationRequest = {
  templateId: 'warm-16x9',
  projectId: 'sales',
  brief: 'Итоги квартала для правления',
  files: [new File(['Выручка,100'], 'выручка.csv')],
  slideCount: null,
  modelId: null,
};

const ids = () => {
  let next = 0;
  return () => `run-${(next += 1)}`;
};

const demo = () => createDemoGenerator({ library: createDemoLibrarySource(), stepMs: 10 });

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
      models: [],
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
});
