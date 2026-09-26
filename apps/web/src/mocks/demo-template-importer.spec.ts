import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jobEventSchema, type JobEvent } from '@lct/contracts';
import { generationProgress } from '../lib/deck-generator';
import { importStages } from '../lib/template-importer';
import { createDemoLibrarySource } from './demo-library';
import { createDemoTemplateImporter } from './demo-template-importer';

const pptx = () => new File(['PK'], 'Бренд 2026.pptx');

/** Итог импорта без необработанного отказа: отказ ловится сразу, проверяется потом. */
const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

describe('createDemoTemplateImporter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('события проходят контракт JobEvent, seq плотный, этапы — разбор и профиль, в конце done', async () => {
    const library = createDemoLibrarySource();
    const importer = createDemoTemplateImporter({
      register: (file) => library.importTemplate(file),
      stepMs: 10,
    });
    const seen: JobEvent[] = [];
    const running = importer.import(
      pptx(),
      (event) => seen.push(event),
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    await running;

    for (const event of seen) expect(() => jobEventSchema.parse(event)).not.toThrow();
    expect(seen.map((event) => event.seq)).toEqual(seen.map((_, index) => index));
    expect(seen.flatMap((event) => (event.type === 'stage-started' ? [event.stage] : []))).toEqual(
      importStages(),
    );
    expect(seen.at(-1)?.type).toBe('done');
    const progress = generationProgress(importStages(), seen);
    expect(progress.finished).toBe(true);
    expect(progress.stages.every((stage) => stage.state === 'done')).toBe(true);
  });

  it('регистрирует шаблон переданной функцией и отдаёт его; профиль честно не из файла', async () => {
    const library = createDemoLibrarySource();
    const register = vi.fn((file: File) => library.importTemplate(file));
    const importer = createDemoTemplateImporter({ register, stepMs: 10 });
    expect(importer.profilesFiles).toBe(false);

    const running = importer.import(pptx(), () => undefined, new AbortController().signal);
    await vi.runAllTimersAsync();
    const template = await running;

    expect(register).toHaveBeenCalledTimes(1);
    expect(template.fileName).toBe('Бренд 2026.pptx');
    const templates = await library.listTemplates();
    expect(templates.some((item) => item.templateId === template.templateId)).toBe(true);
  });

  it('регистрирует только к концу: пока идут этапы, шаблона в библиотеке нет', async () => {
    const register = vi.fn((file: File) => createDemoLibrarySource().importTemplate(file));
    const importer = createDemoTemplateImporter({ register, stepMs: 10 });
    const seen: JobEvent[] = [];
    const running = importer.import(
      pptx(),
      (event) => seen.push(event),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(30);
    expect(seen.length).toBeGreaterThan(0);
    expect(register).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await running;
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('отказ регистрации — отказ импорта без события done', async () => {
    const importer = createDemoTemplateImporter({
      register: () => Promise.reject(new Error('server')),
      stepMs: 10,
    });
    const seen: JobEvent[] = [];
    const settled = settle(
      importer.import(pptx(), (event) => seen.push(event), new AbortController().signal),
    );
    await vi.runAllTimersAsync();
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    expect(seen.some((event) => event.type === 'done')).toBe(false);
  });

  it('отмена останавливает события и отклоняет импорт ошибкой AbortError', async () => {
    const register = vi.fn((file: File) => createDemoLibrarySource().importTemplate(file));
    const importer = createDemoTemplateImporter({ register, stepMs: 10 });
    const controller = new AbortController();
    const seen: JobEvent[] = [];
    const settled = settle(importer.import(pptx(), (event) => seen.push(event), controller.signal));
    await vi.advanceTimersByTimeAsync(25);
    controller.abort();
    const count = seen.length;
    await vi.runAllTimersAsync();
    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(DOMException);
      expect((outcome.error as DOMException).name).toBe('AbortError');
    }
    expect(seen).toHaveLength(count);
    expect(register).not.toHaveBeenCalled();
  });
});
