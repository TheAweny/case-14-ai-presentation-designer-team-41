import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import {
  createGenerationWorkflow,
  fitChars,
  groundedVisual,
  patternUseLimit,
  slotBriefs,
  validateBindings,
  variantCatalog,
} from './workflow.js';
import type { TextProvider } from './provider.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
);
const profile = generationProfileSchema.parse(fixture.valid[0].payload);
const composition = profile.compositions[0];
if (!composition) throw new Error('Fixture has no composition.');

describe('template generation workflow', () => {
  it.each([
    { brief: 'Short', count: 10 },
    { brief: 'Detailed', count: 23 },
  ])('lets the planner size auto mode from $brief context', async ({ brief, count }) => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          expect(input).toMatchObject({ brief, slideCount: null });
          return schema.parse({
            title: 'Auto',
            slides: Array.from({ length: count }, (_, index) => ({
              patternId: composition.patternId,
              purpose: 'Point ' + index,
              imageQuery: '',
            })),
          });
        }
        return schema.parse({
          patternId: composition.patternId,
          textsBySlot: { '2': 'Point' },
          speakerNotes: '',
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief, slideCount: null, profile } });
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.result).toHaveLength(count);
  });
  it('asks the planner once more when a manual count is wrong', async () => {
    let plannerCalls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent !== 'planner')
          return schema.parse({
            patternId: composition.patternId,
            textsBySlot: { '2': 'Point' },
            speakerNotes: '',
          });
        plannerCalls += 1;
        if (plannerCalls === 2)
          expect(input).toMatchObject({
            previous: expect.objectContaining({ slides: expect.any(Array) }),
            corrections: { exactSlideCount: 12, returnedSlideCount: 10 },
          });
        return schema.parse({
          title: 'Wrong count',
          slides: Array.from({ length: plannerCalls === 1 ? 10 : 12 }, (_, index) => ({
            patternId: composition.patternId,
            purpose: `Point ${index + 1}`,
            imageQuery: '',
          })),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Twelve', slideCount: 12, profile } });
    expect(result.status).toBe('success');
    expect(plannerCalls).toBe(2);
  });
  it('retries auto mode when the planner returns fewer than 10 slides', async () => {
    let plannerCalls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        _input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent !== 'planner')
          return schema.parse({
            patternId: composition.patternId,
            textsBySlot: { '2': 'Point' },
            speakerNotes: '',
          });
        plannerCalls += 1;
        return schema.parse({
          title: 'Auto',
          slides: Array.from({ length: plannerCalls === 1 ? 2 : 10 }, (_, index) => ({
            patternId: composition.patternId,
            purpose: `Point ${index + 1}`,
            imageQuery: '',
          })),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Auto', slideCount: null, profile } });
    expect(result.status).toBe('success');
    expect(plannerCalls).toBe(2);
  });
  it('detects over-capacity and missing slot bindings', () => {
    expect(
      validateBindings(
        { patternId: composition.patternId, texts: [], speakerNotes: '' },
        composition,
      ),
    ).not.toHaveLength(0);
    expect(
      validateBindings(
        {
          patternId: composition.patternId,
          texts: [{ slotId: '2', text: 'x'.repeat(1000) }],
          speakerNotes: '',
        },
        composition,
      ),
    ).not.toHaveLength(0);
  });
  it('writes slides concurrently through Mastra with a bounded fanout', async () => {
    let active = 0;
    let peak = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner')
          return schema.parse({
            title: 'Test',
            slides: Array.from({ length: 10 }, (_, i) => ({
              patternId: composition.patternId,
              purpose: `Slide ${i}`,
              imageQuery: '',
            })),
          });
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        const task = input as { purpose: string };
        return schema.parse({
          patternId: composition.patternId,
          textsBySlot: { '2': task.purpose },
          speakerNotes: '',
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      concurrency: 2,
    });
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { brief: 'Test brief', slideCount: 10, profile } });
    expect(result.status).toBe('success');
    expect(peak).toBe(2);
    if (result.status === 'success')
      expect(result.result.map((s) => s.index).sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => i),
      );
  });
  it('fails if the planner selects a composition outside the template', async () => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(_a: string, _i: string, _input: unknown, schema: z.ZodType<T>) {
        return schema.parse({
          title: 'Test',
          slides: Array.from({ length: 10 }, () => ({
            patternId: 'invented',
            purpose: 'Test',
            imageQuery: '',
          })),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { brief: 'Test', slideCount: 10, profile } });
    expect(result.status).toBe('failed');
  });
});

describe('variantCatalog', () => {
  const composition = (patternId: string, body: number) => ({
    patternId,
    sourceIndex: 0,
    name: patternId,
    imageCount: 0,
    slots: [
      {
        slotId: 't',
        role: 'title' as const,
        sample: '',
        maxChars: 40,
        maxLines: 2,
        font: 'A',
        fontSize: 30,
      },
      ...(body
        ? [
            {
              slotId: 'b',
              role: 'body' as const,
              sample: '',
              maxChars: body,
              maxLines: 8,
              font: 'A',
              fontSize: 16,
            },
          ]
        : []),
    ],
  });
  const catalog = [
    composition('cover', 0),
    ...[100, 200, 300, 400, 500, 900].map((body) => composition(`b${body}`, body)),
  ];

  it('gives dense the roomiest layouts and airy the lightest, keeping covers in both', () => {
    const cover = catalog[0] ?? composition('cover', 0);
    const dense = variantCatalog(catalog, 'dense', [cover]).map((p) => p.patternId);
    const airy = variantCatalog(catalog, 'airy', [cover]).map((p) => p.patternId);
    expect(dense).toContain('b900');
    expect(dense).not.toContain('b100');
    expect(airy).toContain('b100');
    expect(airy).not.toContain('b900');
    expect(dense).toContain('cover');
    expect(airy).toContain('cover');
  });

  it('gives balanced the whole catalog', () => {
    expect(variantCatalog(catalog, 'balanced')).toHaveLength(catalog.length);
  });
});

describe('slot fit and reading order', () => {
  it('keeps a title near a short template sample instead of the metric ceiling', () => {
    expect(fitChars({ role: 'title', sample: 'Logic', maxChars: 200 })).toBe(36);
    expect(fitChars({ role: 'body', sample: 'Context', maxChars: 400 })).toBe(9);
    expect(fitChars({ role: 'title', sample: '', maxChars: 80 })).toBe(80);
  });

  it('puts slots that share a vertical band on one row', () => {
    const briefs = slotBriefs([
      {
        slotId: 'a',
        role: 'title',
        sample: 'A',
        maxChars: 40,
        maxLines: 1,
        font: 'F',
        fontSize: 28,
        box: { x: 0, y: 0, cx: 100, cy: 40 },
      },
      {
        slotId: 'b',
        role: 'body',
        sample: 'B',
        maxChars: 80,
        maxLines: 2,
        font: 'F',
        fontSize: 16,
        box: { x: 200, y: 10, cx: 100, cy: 40 },
      },
      {
        slotId: 'c',
        role: 'body',
        sample: 'C',
        maxChars: 80,
        maxLines: 2,
        font: 'F',
        fontSize: 16,
        box: { x: 0, y: 200, cx: 100, cy: 40 },
      },
    ]);
    const byId = Object.fromEntries(briefs.map((slot) => [slot.slotId, slot]));
    expect(byId.a?.row).toBe(byId.b?.row);
    expect(byId.c?.row).not.toBe(byId.a?.row);
    expect(byId.b?.column).toBe(1);
  });

  it('caps repeats only when the template offers more than two compositions', () => {
    expect(patternUseLimit(6, 10)).toBe(2);
    expect(patternUseLimit(2, 10)).toBe(5);
    expect(patternUseLimit(1, 10)).toBe(10);
  });

  it('rejects a title inside the metric ceiling but past the visible budget', () => {
    const slot = composition.slots[0];
    if (!slot) throw new Error('Fixture slot missing');
    const pattern = { ...composition, slots: [{ ...slot, sample: 'Logic', maxChars: 80 }] };
    expect(
      validateBindings(
        {
          patternId: pattern.patternId,
          texts: [{ slotId: slot.slotId, text: 'S'.repeat(50) }],
          speakerNotes: '',
        },
        pattern,
      ).some((error) => error.includes('36')),
    ).toBe(true);
  });
});

describe('groundedVisual', () => {
  const brief = 'Выручка: Q1 10, Q2 12, Q3 15 млн ₽. Удержание 94%.';
  const chart = {
    kind: 'chart' as const,
    slotId: '5',
    chartType: 'column' as const,
    categories: ['Q1', 'Q2', 'Q3'],
    series: [{ name: 'Выручка', values: [10, 12, 15] }],
    xTitle: 'Квартал',
    yTitle: 'млн ₽',
  };

  it('keeps a chart whose figures are all in the brief', () => {
    expect(groundedVisual(chart, brief)).toEqual(chart);
  });

  it('drops a chart with a figure the brief does not have', () => {
    expect(
      groundedVisual({ ...chart, series: [{ name: 'Выручка', values: [10, 12, 17] }] }, brief),
    ).toBeNull();
  });

  it('drops a table whose rows do not match its header', () => {
    expect(
      groundedVisual({ kind: 'table', slotId: '5', headers: ['A', 'B'], rows: [['94%']] }, brief),
    ).toBeNull();
  });
});
