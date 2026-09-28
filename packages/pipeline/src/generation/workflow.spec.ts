import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import {
  createGenerationWorkflow,
  groundedVisual,
  remapPlan,
  SharedPlan,
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

describe('one plan, three layouts', () => {
  const composition = (patternId: string, bodies: number[]) => ({
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
      ...bodies.map((maxChars, i) => ({
        slotId: `b${i}`,
        role: 'body' as const,
        sample: '',
        maxChars,
        maxLines: 8,
        font: 'A',
        fontSize: 16,
      })),
    ],
  });
  const cover = composition('cover', []);
  const full = [
    cover,
    ...[150, 300, 450, 600, 900, 1200].map((n) => composition(`one-${n}`, [n])),
    ...[200, 800].map((n) => composition(`two-${n}`, [n, n])),
  ];
  const planned = ['cover', 'one-450', 'one-450', 'one-450', 'two-200', 'one-600'];

  it('computes a shared plan once for every variant', async () => {
    const shared = new SharedPlan();
    let calls = 0;
    const plan = { title: 'T', slides: [] };
    const compute = () => {
      calls += 1;
      return Promise.resolve(plan);
    };
    const results = await Promise.all([
      shared.once(compute),
      shared.once(compute),
      shared.once(compute),
    ]);
    expect(calls).toBe(1);
    expect(results.every((r) => r === plan)).toBe(true);
  });

  it('keeps the planner layouts for balanced and the cover everywhere', () => {
    expect(remapPlan(planned, full, full, 'balanced', [cover])).toEqual(planned);
    for (const variant of ['dense', 'airy'] as const) {
      const catalog = variantCatalog(full, variant, [cover]);
      expect(remapPlan(planned, full, catalog, variant, [cover])[0]).toBe('cover');
    }
  });

  it('gives dense roomier and airy lighter layouts with the same number of text blocks', () => {
    const dense = remapPlan(planned, full, variantCatalog(full, 'dense', [cover]), 'dense', [
      cover,
    ]);
    const airy = remapPlan(planned, full, variantCatalog(full, 'airy', [cover]), 'airy', [cover]);
    const capacity = (id: string) =>
      full
        .find((p) => p.patternId === id)
        ?.slots.reduce((sum, s) => sum + (s.role === 'body' ? s.maxChars : 0), 0) ?? 0;
    for (let i = 1; i < planned.length; i += 1) {
      expect(capacity(dense[i] ?? '')).toBeGreaterThan(capacity(airy[i] ?? ''));
    }
    expect(dense[4]?.startsWith('two-')).toBe(true);
    expect(airy[4]?.startsWith('two-')).toBe(true);
  });

  it('spreads repeated slides over several layouts', () => {
    const dense = remapPlan(planned, full, variantCatalog(full, 'dense', [cover]), 'dense', [
      cover,
    ]);
    expect(new Set(dense.slice(1, 4)).size).toBe(3);
  });
});
