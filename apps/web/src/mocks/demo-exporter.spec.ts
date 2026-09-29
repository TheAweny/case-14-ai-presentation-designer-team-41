import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobEventSchema, type JobEvent } from '@lct/contracts';
import { exportProgress, plannedStages, type ExportRequest } from '../lib/deck-export';
import { DEMO_DECK } from './demo-deck';
import { createDemoExporter, eventsFor } from './demo-exporter';

const request: ExportRequest = {
  deckId: DEMO_DECK.deckId,
  fileName: 'Демо',
  format: 'pptx',
  variant: DEMO_DECK.variant,
  slides: DEMO_DECK.slides.slice(0, 3),
  designSystem: DEMO_DECK.designSystem,
};

describe('eventsFor', () => {
  it('каждое событие проходит контракт JobEvent, seq плотный', () => {
    const events = eventsFor(request, 'run');
    for (const event of events) expect(jobEventSchema.safeParse(event).success).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });

  it('проходит запланированные этапы и заканчивается done', () => {
    const events = eventsFor(request, 'run');
    const progress = exportProgress(plannedStages(), events);
    expect(progress.finished).toBe(true);
    expect(progress.stages.map((stage) => stage.stage)).toEqual(plannedStages());
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('createDemoExporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('проигрывает события и честно отвечает, что файла нет', async () => {
    const seen: JobEvent[] = [];
    const running = createDemoExporter({ stepMs: 10 }).export(
      request,
      (event) => seen.push(event),
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await expect(running).resolves.toEqual({ fileName: 'Демо.pptx', url: null });
    expect(seen).toHaveLength(eventsFor(request, 'run').length);
  });

  it('отмена останавливает события и отклоняет обещание AbortError', async () => {
    const seen: JobEvent[] = [];
    const controller = new AbortController();
    const running = createDemoExporter({ stepMs: 10 }).export(
      request,
      (event) => seen.push(event),
      controller.signal,
    );
    const outcome = running.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(25);
    controller.abort();
    const count = seen.length;
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ name: 'AbortError' });
    expect(seen).toHaveLength(count);
  });
});
