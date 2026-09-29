import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  compositionPlanSchema,
  generationProfileSchema,
  type CompositionNote,
} from '@lct/contracts';
import {
  copyDefects,
  createGenerationWorkflow,
  fitChars,
  groundedVisual,
  keepOutline,
  missingRequiredContent,
  mirroredSlots,
  numberedSlots,
  overusedPatterns,
  patternUseLimit,
  writerSlots,
  slotBriefs,
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
  it('lays out an approved outline slide for slide, in its words', async () => {
    const outline = {
      title: 'Зелёный офис',
      audience: 'HR-директора IT-компаний',
      goal: 'Заказать эко-аудит',
      slides: Array.from({ length: 11 }, (_, index) => ({
        title: `Тезис ${index + 1}`,
        points: [`Факт ${index + 1}`],
        kind: 'statement' as const,
      })),
    };
    const purposes: string[] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          expect(input).toMatchObject({ slideCount: 11, outline });
          return schema.parse({
            title: 'Другое название',
            slides: outline.slides.map((_, index) => ({
              patternId: composition.patternId,
              purpose: index === 0 ? 'Тезис 1 — Факт 1' : 'Пересказ своими словами',
              imageQuery: '',
            })),
          });
        }
        purposes.push((input as { purpose: string }).purpose);
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
    ).start({ inputData: { brief: 'Бриф', slideCount: null, profile, outline } });
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.result).toHaveLength(11);
    expect(purposes.sort()).toContain('Тезис 7 — Факт 7');
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
    expect(patternUseLimit(3, 10)).toBe(4);
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

  const withLabel = () => {
    const title = composition.slots[0];
    if (!title) throw new Error('Fixture slot missing');
    const label = {
      ...title,
      slotId: '8',
      role: 'body' as const,
      sample: 'Label',
      maxChars: 24,
      box: title.box ? { ...title.box, y: title.box.y + title.box.cy * 2 } : undefined,
    };
    const pattern = { ...composition, slots: [title, label] };
    return {
      title,
      pattern,
      profile: {
        ...profile,
        compositions: profile.compositions.map((item) =>
          item.patternId === pattern.patternId ? pattern : item,
        ),
      },
    };
  };
  const labelProvider = (rewrite: string, rewritten: string[]): TextProvider => ({
    model: 'fake',
    async generate<T>(agent: string, _instructions: string, input: unknown, schema: z.ZodType<T>) {
      const { title, pattern } = withLabel();
      if (agent === 'planner')
        return schema.parse({
          title: 'Blank label',
          slides: Array.from({ length: 10 }, () => ({
            patternId: pattern.patternId,
            purpose: 'Point',
            imageQuery: '',
          })),
        });
      if (agent === 'rewriter') {
        rewritten.push(JSON.stringify(input));
        return schema.parse({ rewrites: { '8': [rewrite, rewrite, rewrite] } });
      }
      return schema.parse({
        patternId: pattern.patternId,
        textsBySlot: { [title.slotId]: 'Point', '8': '' },
        speakerNotes: '',
        visual: null,
      });
    },
  });
  const runLabel = async (provider: TextProvider) => {
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    return (await workflow.createRun()).start({
      inputData: { brief: 'Point', slideCount: null, profile: withLabel().profile },
    });
  };

  it('sends an empty card to the rewriter and keeps the point it writes', async () => {
    const rewritten: string[] = [];
    const result = await runLabel(labelProvider('Speed', rewritten));
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(rewritten.some((input) => input.includes('empty'))).toBe(true);
    for (const written of result.result)
      expect(written.slide.texts.find((t) => t.slotId === '8')?.text).toBe('Speed');
  });

  it('does not fail the deck when an empty card cannot be filled', async () => {
    const result = await runLabel(labelProvider('', []));
    expect(result.status).toBe('success');
  });

  it('reports an empty card but not a mirrored twin of a filled slot', () => {
    const { pattern } = withLabel();
    const title = { ...withLabel().title, box: { x: 10, y: 10, cx: 100, cy: 20 } };
    const twin = { ...title, slotId: '9' };
    const mirrored = { ...pattern, slots: [title, twin] };
    expect(mirroredSlots(mirrored)).toEqual(new Set(['9']));
    expect(
      validateBindings(
        {
          patternId: pattern.patternId,
          texts: [
            { slotId: title.slotId, text: 'Point' },
            { slotId: '9', text: '' },
          ],
          speakerNotes: '',
        },
        mirrored,
      ),
    ).toEqual([]);
    expect(
      validateBindings(
        {
          patternId: pattern.patternId,
          texts: [
            { slotId: title.slotId, text: 'Point' },
            { slotId: '8', text: '' },
          ],
          speakerNotes: '',
        },
        pattern,
      ),
    ).toEqual(['Fill empty slot 8']);
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

describe('numberedSlots', () => {
  const base = composition.slots[0];
  if (!base) throw new Error('Fixture slot missing');
  const card = (slotId: string, sample: string, x: number, y: number) => ({
    ...base,
    slotId,
    role: 'body' as const,
    sample,
    box: { x, y, cx: 100, cy: 20 },
  });

  it('numbers a drawn sequence in reading order and keeps it from the writer', () => {
    const pattern = {
      ...composition,
      slots: [
        { ...base, box: { x: 0, y: 0, cx: 500, cy: 40 } },
        card('b', '03', 0, 200),
        card('a', '01', 0, 100),
        card('c', '02', 300, 100),
        card('text', 'Card copy', 0, 130),
      ],
    };
    expect(Object.fromEntries(numberedSlots(pattern))).toEqual({ a: '01', c: '02', b: '03' });
    expect(writerSlots(pattern).map((slot) => slot.slotId)).toEqual([base.slotId, 'text']);
  });

  it('reads a row left to right even when its slots sit a few units apart in height', () => {
    const row = {
      ...composition,
      slots: [card('c', '03', 200, 98), card('a', '01', 0, 101), card('b', '02', 100, 100)],
    };
    expect([...numberedSlots(row)]).toEqual([
      ['a', '01'],
      ['b', '02'],
      ['c', '03'],
    ]);
  });

  it('keeps the sample format and leaves a single section number to the writer', () => {
    const steps = { ...composition, slots: [card('x', '1.', 0, 0), card('y', '2.', 0, 100)] };
    expect([...numberedSlots(steps).values()]).toEqual(['1.', '2.']);
    const section = { ...composition, slots: [card('x', '01', 0, 0), card('t', 'Copy', 0, 100)] };
    expect(numberedSlots(section).size).toBe(0);
  });
});

describe('fitChars', () => {
  it('measures a layout prompt by its box, and template copy by its own length', () => {
    const slot = { role: 'body', sample: 'Образец текста', maxChars: 300 };
    expect(fitChars({ ...slot, prompt: true })).toBe(300);
    expect(fitChars(slot)).toBe(18);
  });
});

describe('overusedPatterns', () => {
  it('flags a layout over its limit and one repeated on three slides in a row', () => {
    expect(overusedPatterns(['a', 'b', 'a', 'c', 'a'], 2)).toEqual(['a']);
    expect(overusedPatterns(['a', 'b', 'b', 'b', 'c'], 3)).toEqual(['b']);
    expect(overusedPatterns(['a', 'b', 'a', 'b', 'c'], 2)).toEqual([]);
  });
});

describe('copyDefects', () => {
  const base = composition.slots[0];
  if (!base) throw new Error('Fixture slot missing');
  const slot = (slotId: string, maxChars: number, maxLines: number) => ({
    ...base,
    slotId,
    role: 'body' as const,
    sample: 'A template sample of thirty two',
    maxChars,
    maxLines,
  });
  const slide = (texts: Record<string, string>) => ({
    patternId: composition.patternId,
    texts: Object.entries(texts).map(([slotId, text]) => ({ slotId, text })),
    speakerNotes: '',
  });

  it('flags the same phrase in two slots of one slide, not the first of them', () => {
    const pattern = { ...composition, slots: [slot('a', 40, 1), slot('b', 40, 1)] };
    const defects = copyDefects(slide({ a: 'Больничные', b: ' больничные ' }), pattern);
    expect([...defects.keys()]).toEqual(['b']);
    expect(validateBindings(slide({ a: 'Больничные', b: 'Больничные' }), pattern)).toEqual([
      'Revise slot b',
    ]);
  });

  it('flags a word longer than one line of a narrow box', () => {
    const pattern = { ...composition, slots: [slot('a', 99, 9)] };
    expect(copyDefects(slide({ a: 'Корпоративные программы' }), pattern).has('a')).toBe(true);
    expect(copyDefects(slide({ a: 'Программы для команды' }), pattern).size).toBe(0);
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
    const plan = { audience: '', goal: '', title: 'T', slides: [] };
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

  it('never swaps an ordinary slide onto a special layout, nor a special one away', () => {
    const special = (patternId: string) =>
      [
        patternId,
        {
          patternId,
          kind: 'statement' as const,
          items: 1,
          useFor: 'code',
          title: 'Code',
          skip: false,
          special: true,
          requiredContent: [] as CompositionNote['requiredContent'],
        },
      ] as const;
    // The roomiest one-block layout is kept for code: dense would pick it otherwise.
    const notes = new Map<string, CompositionNote>([special('one-1200'), special('one-150')]);
    const plan = ['cover', 'one-450', 'one-150', 'one-600'];
    for (const variant of ['dense', 'airy'] as const) {
      const catalog = variantCatalog(full, variant, [cover]);
      const layouts = remapPlan(plan, full, catalog, variant, [cover], notes);
      expect(layouts[2]).toBe('one-150');
      expect([layouts[1], layouts[3]]).not.toContain('one-1200');
      expect([layouts[1], layouts[3]]).not.toContain('one-150');
    }
  });

  it('spreads repeated slides over several layouts', () => {
    const dense = remapPlan(planned, full, variantCatalog(full, 'dense', [cover]), 'dense', [
      cover,
    ]);
    expect(new Set(dense.slice(1, 4)).size).toBe(3);
  });

  it('does not remap an ordinary slide onto one requiring a named person', () => {
    const note = (patternId: string, requiredContent: CompositionNote['requiredContent']) =>
      [
        patternId,
        {
          patternId,
          kind: 'statement' as const,
          items: 1,
          useFor: 'one point',
          title: 'One point',
          skip: false,
          special: false,
          requiredContent,
        },
      ] as const;
    const notes = new Map([note('one-150', ['person-name']), note('one-450', [])]);
    const layouts = remapPlan(
      ['cover', 'one-450'],
      full,
      [cover, ...full.filter((p) => p.patternId === 'one-150')],
      'airy',
      [cover],
      notes,
    );
    expect(layouts).toEqual(['cover', 'one-450']);
  });
});

describe('composition requirements', () => {
  const notes = new Map<string, CompositionNote>([
    [
      'speaker',
      {
        patternId: 'speaker',
        kind: 'team',
        items: 1,
        useFor: 'speaker profile',
        title: 'Speaker',
        skip: false,
        special: false,
        requiredContent: ['person-name'],
      },
    ],
  ]);
  const plan = (quote: string) =>
    compositionPlanSchema.parse({
      title: 'Deck',
      slides: Array.from({ length: 10 }, (_, index) => ({
        patternId: index === 1 ? 'speaker' : 'statement',
        purpose: 'One claim',
        sourceEvidence: index === 1 ? { 'person-name': quote } : {},
      })),
    });

  it('rejects a speaker layout without a cited full name from the source', () => {
    const source = 'Спикер Анна Иванова расскажет о проекте.';
    expect(missingRequiredContent(plan(''), notes, source)).toHaveLength(1);
    expect(missingRequiredContent(plan('Анна'), notes, source)).toHaveLength(1);
    expect(missingRequiredContent(plan('Иван Петров'), notes, source)).toHaveLength(1);
    expect(missingRequiredContent(plan('Анна Иванова'), notes, source)).toEqual([]);
  });
});

describe('keepOutline', () => {
  it('titles the deck as the outline and gives a slide that lost its claim the outline words', () => {
    const plan = {
      title: 'План',
      audience: 'Кто-то',
      goal: '',
      slides: [
        { patternId: 'a', purpose: 'Рынок растёт — 12% в год', imageQuery: '', sourceEvidence: {} },
        { patternId: 'b', purpose: 'Что-то общее', imageQuery: '', sourceEvidence: {} },
      ],
    };
    const kept = keepOutline(plan, {
      title: 'Колода',
      audience: '',
      goal: 'Решить',
      slides: [
        { title: 'Рынок растёт', points: [], kind: 'statement' },
        { title: 'Мы быстрее', points: ['в 2 раза', 'без простоя'], kind: 'list' },
      ],
    });
    expect(kept).toMatchObject({ title: 'Колода', audience: 'Кто-то', goal: 'Решить' });
    expect(kept.slides.map((slide) => slide.purpose)).toEqual([
      'Рынок растёт — 12% в год',
      'Мы быстрее — в 2 раза; без простоя',
    ]);
  });
});
