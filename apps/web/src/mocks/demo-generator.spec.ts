import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobEventSchema, type JobEvent } from '@lct/contracts';
import {
  LAYOUT_VARIANTS,
  generationProgress,
  plannedStages,
  type GenerationRequest,
  type StreamedSlide,
} from '../lib/deck-generator';
import { TemplateNotFoundError } from '../lib/library-source';
import { createDemoGenerator } from './demo-generator';
import { DEMO_DECKS, createDemoLibrary, createDemoLibrarySource } from './demo-library';

const library = createDemoLibrarySource();

const withTemplate = (templateId: string, projectId: string | null = null): GenerationRequest => ({
  templateId,
  projectId,
  brief: 'Итоги квартала для правления',
  files: [],
  slideCount: null,
  modelId: null,
});

const WARM = 'warm-16x9';
const NEUTRAL = 'neutral-16x9';

/** Прогон до конца на фейковых таймерах: события и результат. */
async function runToEnd(request: GenerationRequest, source = library) {
  const seen: JobEvent[] = [];
  const running = createDemoGenerator({ library: source, stepMs: 10 }).generate(
    request,
    (event) => seen.push(event),
    new AbortController().signal,
  );
  await vi.runAllTimersAsync();
  return { seen, result: await running };
}

describe('createDemoGenerator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('каждое событие проходит контракт JobEvent, seq плотный, в конце done', async () => {
    const { seen } = await runToEnd(withTemplate(WARM, 'sales'));
    for (const event of seen) expect(() => jobEventSchema.parse(event)).not.toThrow();
    expect(seen.map((event) => event.seq)).toEqual(seen.map((_, index) => index));
    expect(seen.at(-1)?.type).toBe('done');
  });

  it('этапы идут в порядке плана, каждый начат до прогресса и закончен', async () => {
    for (const request of [withTemplate(NEUTRAL, 'hackathon'), withTemplate(WARM)]) {
      const { seen } = await runToEnd(request);
      const started = seen.flatMap((event) =>
        event.type === 'stage-started' ? [event.stage] : [],
      );
      expect(started).toEqual(plannedStages());
      for (const stage of started) {
        const ofStage = seen.filter((event) => 'stage' in event && event.stage === stage);
        expect(ofStage[0]?.type).toBe('stage-started');
        expect(ofStage.at(-1)?.type).toBe('stage-finished');
      }
      const progress = generationProgress(plannedStages(), seen);
      expect(progress.finished).toBe(true);
      expect(progress.previewed).toEqual(LAYOUT_VARIANTS);
    }
  });

  it('три варианта указывают на существующие колоды, свёрстанные выбранным шаблоном', async () => {
    const warm = await library.getTemplate(WARM);
    const own = new Set(
      (await library.listDecks())
        .filter((deck) => deck.templateId === WARM)
        .map((deck) => deck.deckId),
    );
    const { result } = await runToEnd(withTemplate(WARM, 'sales'));
    expect(result.variants.map((item) => item.variant)).toEqual(LAYOUT_VARIANTS);
    expect(result.templateSubstituted).toBe(false);
    for (const item of result.variants) {
      expect(own.has(item.deckId)).toBe(true);
      const deck = DEMO_DECKS.find((candidate) => candidate.deckId === item.deckId);
      expect(deck?.slides.length).toBe(item.slideCount);
      expect(item.designSystem).toEqual(warm.designSystem);
    }
  });

  it('с источником колод отдаёт слайды сбалансированного варианта по одному, за их прогрессом', async () => {
    const demo = createDemoLibrary();
    const order: string[] = [];
    const slides: StreamedSlide[] = [];
    const running = createDemoGenerator({
      library: demo.library,
      decks: demo.decks,
      stepMs: 10,
    }).generate(
      withTemplate(WARM, 'sales'),
      (event) => {
        if (event.type === 'stage-progress' && event.stage === 'laying-out') {
          order.push(`progress ${event.done}/${event.total}`);
        }
      },
      new AbortController().signal,
      (slide) => {
        slides.push(slide);
        order.push(`slide ${slide.index + 1}/${slide.total}`);
      },
    );
    await vi.runAllTimersAsync();
    const result = await running;
    const balanced = result.variants.find((item) => item.variant === 'balanced');
    const deck = DEMO_DECKS.find((candidate) => candidate.deckId === balanced?.deckId);
    expect(slides.map((item) => item.slide)).toEqual(deck?.slides);
    expect(order).toEqual(
      slides.flatMap((item) => [
        `progress ${item.index + 1}/${item.total}`,
        `slide ${item.index + 1}/${item.total}`,
      ]),
    );
  });

  it('на шаблоне без колод (только что загруженном) честно помечает подмену', async () => {
    const source = createDemoLibrarySource();
    const imported = await source.importTemplate({ name: 'Бренд.pptx', size: 1024 });
    const ids = new Set(DEMO_DECKS.map((deck) => deck.deckId));
    const { result } = await runToEnd(withTemplate(imported.templateId), source);
    expect(result.templateSubstituted).toBe(true);
    expect(result.variants.every((item) => ids.has(item.deckId))).toBe(true);
  });

  it('неизвестный шаблон — отказ без выдуманных колод', async () => {
    const running = createDemoGenerator({ library, stepMs: 10 }).generate(
      withTemplate('nope'),
      () => undefined,
      new AbortController().signal,
    );
    const outcome = running.catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();
    expect(await outcome).toBeInstanceOf(TemplateNotFoundError);
  });

  it('отмена останавливает события и отклоняет обещание AbortError', async () => {
    const seen: JobEvent[] = [];
    const controller = new AbortController();
    const running = createDemoGenerator({ library, stepMs: 10 }).generate(
      withTemplate(NEUTRAL, 'hackathon'),
      (event) => seen.push(event),
      controller.signal,
    );
    const outcome = running.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(35);
    expect(seen.length).toBeGreaterThan(0);
    controller.abort();
    const count = seen.length;
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(seen).toHaveLength(count);
  });

  it('отменённый заранее прогон не шлёт ни одного события', async () => {
    const seen: JobEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    const outcome = createDemoGenerator({ library, stepMs: 10 })
      .generate(withTemplate(NEUTRAL, 'hackathon'), (event) => seen.push(event), controller.signal)
      .catch((reason: unknown) => reason);
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([]);
  });
});
