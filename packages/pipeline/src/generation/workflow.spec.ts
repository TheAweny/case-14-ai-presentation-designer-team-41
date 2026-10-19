import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import {
  compositionPlanSchema,
  generationProfileSchema,
  type CompositionNote,
} from '@lct/contracts';
import {
  clearEchoes,
  copyDefects,
  createGenerationWorkflow,
  createRepairWorkflow,
  datedSlots,
  deckYear,
  emptySlots,
  keepStatedFacts,
  repeatsHeading,
  withCardHeadings,
  fitChars,
  groundedVisual,
  keepOutline,
  minChars,
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
  withoutMissingContent,
  prepareVariantCatalog,
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
  it('offers a QR-only composition without an image provider but excludes QR mixed with a required photo', () => {
    const qrSlot = {
      slotId: 'qr-image',
      kind: 'photo' as const,
      box: { x: 0, y: 0, cx: 4_000_000, cy: 4_000_000 },
    };
    const qr = {
      ...composition,
      patternId: 'qr',
      name: 'QR link',
      imageSlots: [qrSlot],
      qrCandidateSlots: [qrSlot],
    };
    const mixed = {
      ...qr,
      patternId: 'mixed',
      name: 'QR with photo',
      imageSlots: [qrSlot, { ...qrSlot, slotId: 'photo' }],
    };
    const notes: CompositionNote[] = [qr, mixed].map((p) => ({
      patternId: p.patternId,
      kind: 'statement',
      items: 1,
      title: 'QR',
      useFor: 'QR',
      skip: false,
      special: true,
      qrSlotIds: ['qr-image'],
      requiredContent: ['image'],
    }));
    const catalog = prepareVariantCatalog({ compositions: [composition, qr, mixed] }, notes, {
      imagesAvailable: false,
      variant: 'balanced',
    });
    expect(catalog.full.map((p) => p.patternId)).toContain('qr');
    expect(catalog.full.map((p) => p.patternId)).not.toContain('mixed');
  });
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

  it('hands the writer the composition chosen by the remap policy', async () => {
    const slot = (slotId: string, maxChars: number) => ({
      slotId,
      role: 'body' as const,
      sample: '',
      maxChars,
      maxLines: 4,
      font: 'A',
      fontSize: 16,
    });
    const pattern = (patternId: string, bodies: number[]) => ({
      ...composition,
      patternId,
      name: patternId,
      slots: [
        {
          slotId: 't',
          role: 'title' as const,
          sample: '',
          maxChars: 40,
          maxLines: 1,
          font: 'A',
          fontSize: patternId === 'cover' ? 44 : 24,
        },
        ...bodies.map((maxChars, index) => slot(`b${index}`, maxChars)),
      ],
    });
    const catalog = [
      pattern('cover', []),
      pattern('planned', [300, 300]),
      pattern('one', [800]),
      pattern('three', [900, 900, 900]),
      pattern('four', [1200, 1200, 1200, 1200]),
      pattern('five', [1500, 1500, 1500, 1500, 1500]),
      pattern('six', [1800, 1800, 1800, 1800, 1800, 1800]),
    ];
    const written: string[] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          return schema.parse({
            title: 'Policy',
            slides: Array.from({ length: 10 }, (_, index) => ({
              patternId: index === 0 ? 'cover' : 'planned',
              purpose: `Point ${index + 1}`,
              imageQuery: '',
            })),
          });
        }
        const task = input as { composition: { patternId: string } };
        const patternId = task.composition.patternId;
        if (patternId !== 'cover') {
          written.push(patternId);
          throw new Error('Writer composition captured');
        }
        return schema.parse({
          patternId,
          textsBySlot: { t: 'Title' },
          speakerNotes: '',
        });
      },
    };
    const run = async (layoutRemapPolicy?: 'density' | 'preserve-block-count') => {
      written.length = 0;
      const workflow = createGenerationWorkflow({
        provider,
        plannerInstructions: '',
        writerInstructions: '',
        variant: 'dense',
        concurrency: 1,
        ...(layoutRemapPolicy ? { layoutRemapPolicy } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const result = await (
        await workflow.createRun()
      ).start({
        inputData: {
          brief: 'Policy',
          slideCount: 10,
          profile: { ...profile, compositions: catalog },
        },
      });
      expect(result.status).toBe('failed');
      return written[0];
    };
    expect(await run()).toBe('three');
    expect(await run('density')).toBe('three');
    expect(await run('preserve-block-count')).toBe('planned');
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

describe('image slots in the plan', () => {
  const clone = (patternId: string, imageSlots?: { slotId: string; kind: 'panel' }[]) => ({
    ...composition,
    patternId,
    name: patternId,
    slots: composition.slots.map((slot, index) => ({ ...slot, sample: `${patternId} ${index}` })),
    ...(imageSlots
      ? { imageSlots: imageSlots.map((s) => ({ ...s, box: { x: 0, y: 0, cx: 800, cy: 600 } })) }
      : {}),
  });
  const pictured = clone('pictured', [{ slotId: '99', kind: 'panel' }]);
  const catalog = [clone('a'), clone('b'), clone('c'), pictured];

  async function plan(imagesAvailable: boolean) {
    let offered: string[] = [];
    let planned: string[] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(agent: string, _i: string, input: unknown, schema: z.ZodType<T>) {
        if (agent === 'planner') {
          const request = input as { catalog: { patternId: string }[]; imagesAvailable: boolean };
          expect(request.imagesAvailable).toBe(imagesAvailable);
          offered = request.catalog.map((c) => c.patternId);
          return schema.parse({
            title: 'Deck',
            slides: offered
              .slice(0, 10)
              .concat(Array(10).fill(offered[0]))
              .slice(0, 10)
              .map((patternId, index) => ({
                patternId,
                purpose: `Point ${index}`,
                imageQuery: 'plants',
              })),
          });
        }
        return schema.parse({ patternId: 'x', textsBySlot: {}, speakerNotes: '' });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      imagesAvailable,
      onPlan: (slides) => {
        planned = slides.map((slide) => slide.composition.patternId);
      },
      signal: AbortSignal.timeout(10000),
    });
    const run = await workflow.createRun();
    await run.start({
      inputData: {
        brief: 'Brief',
        slideCount: 10,
        profile: { ...profile, compositions: catalog },
      },
    });
    return { offered, planned };
  }

  it('offers a composition with a place for a picture only when pictures can be drawn', async () => {
    expect((await plan(false)).offered).not.toContain('pictured');
    const withImages = await plan(true);
    expect(withImages.offered).toContain('pictured');
    // The laid-out plan reaches the illustrator before any copy is written.
    expect(withImages.planned).toHaveLength(10);
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
    // A one-word heading over a step in a wide one-line box holds a two-word name.
    expect(fitChars({ role: 'body', sample: 'Работа', maxChars: 39, maxLines: 1 })).toBe(13);
    expect(fitChars({ role: 'body', sample: 'Тег', maxChars: 12, maxLines: 1 })).toBe(8);
  });

  it('never lets a repair rewrite a date or a number code wrote', async () => {
    const base = composition.slots[0];
    if (!base) throw new Error('Fixture slot missing');
    const date = { ...base, slotId: 'd', role: 'body' as const, sample: 'Дата' };
    const pattern = { ...composition, slots: [date] };
    const provider: TextProvider = {
      model: 'fake',
      async generate() {
        throw new Error('The rewriter must not be asked.');
      },
    };
    const workflow = createRepairWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: [
        {
          index: 0,
          brief: '',
          composition: pattern,
          previous: {
            patternId: pattern.patternId,
            texts: [{ slotId: 'd', text: '2026' }],
            speakerNotes: '',
          },
          corrections: [{ slotId: 'd', message: 'Заменить «2026» на «2025»' }],
        },
      ],
    });
    expect(result.status).toBe('success');
    if (result.status === 'success')
      expect(result.result[0]?.slide.texts).toEqual([{ slotId: 'd', text: '2026' }]);
  });

  it('keeps copy that fits when no rewrite of it does', async () => {
    const base = composition.slots[0];
    if (!base) throw new Error('Fixture slot missing');
    const label = { ...base, slotId: 'h', role: 'body' as const, sample: 'Работа' };
    const pattern = { ...composition, slots: [{ ...label, maxChars: 39, maxLines: 1 }] };
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(_a: string, _i: string, _input: unknown, schema: z.ZodType<T>) {
        return schema.parse({
          rewrites: { h: ['Эко-аудит офиса и всех его зон', 'x'.repeat(20), 'y'.repeat(14)] },
        });
      },
    };
    const workflow = createRepairWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: [
        {
          index: 0,
          brief: '',
          composition: pattern,
          previous: {
            patternId: pattern.patternId,
            texts: [{ slotId: 'h', text: 'Аудит' }],
            speakerNotes: '',
          },
          corrections: [{ slotId: 'h', message: 'Заменить «Аудит» на «Эко-аудит офиса»' }],
        },
      ],
    });
    expect(result.status).toBe('success');
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

  it('asks the rewriter again with feedback when every alternative exceeds the slot limit', async () => {
    const inputs: unknown[] = [];
    let calls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        const { title, pattern } = withLabel();
        if (agent === 'planner')
          return schema.parse({
            title: 'Overlong label',
            slides: Array.from({ length: 10 }, () => ({
              patternId: pattern.patternId,
              purpose: 'Point',
              imageQuery: '',
            })),
          });
        if (agent === 'rewriter') {
          inputs.push(input);
          calls += 1;
          // First answer ignores the limit, the retry obeys it.
          const rewrites =
            calls === 1
              ? { '8': ['way too long text', 'still too long', 'much too long'] }
              : { '8': ['Speed', 'Go', 'Ok'] };
          return schema.parse({ rewrites });
        }
        const first =
          typeof input === 'object' &&
          input !== null &&
          'index' in input &&
          (input as { index?: number }).index === 0;
        return schema.parse({
          patternId: pattern.patternId,
          textsBySlot: {
            [title.slotId]: 'Point',
            // Only the first slide overflows, so the rewriter runs once.
            '8': first ? 'an overlong label text' : 'Speed',
          },
          speakerNotes: '',
          visual: null,
        });
      },
    };
    const result = await runLabel(provider);
    expect(result.status).toBe('success');
    expect(calls).toBe(2);
    const second = inputs[1] as {
      feedback?: string;
      slots?: { slotId: string; fitChars: number }[];
    };
    expect(second.feedback).toMatch(/8/);
    expect(second.feedback).toMatch(/не длиннее/);
    if (result.status !== 'success') return;
    for (const written of result.result)
      expect(written.slide.texts.find((t) => t.slotId === '8')?.text).toBe('Speed');
  });

  it('keeps the previous copy and still completes when every rewrite attempt overflows the slot limit', async () => {
    const inputs: unknown[] = [];
    let calls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        const { title, pattern } = withLabel();
        if (agent === 'planner')
          return schema.parse({
            title: 'Stubborn label',
            slides: Array.from({ length: 10 }, () => ({
              patternId: pattern.patternId,
              purpose: 'Point',
              imageQuery: '',
            })),
          });
        if (agent === 'rewriter') {
          inputs.push(input);
          calls += 1;
          // The model never obeys the limit: every draw stays too long.
          return schema.parse({
            rewrites: { '8': ['way too long text', 'still too long', 'again too long'] },
          });
        }
        const first =
          typeof input === 'object' &&
          input !== null &&
          'index' in input &&
          (input as { index?: number }).index === 0;
        return schema.parse({
          patternId: pattern.patternId,
          textsBySlot: {
            [title.slotId]: 'Point',
            // Only the first slide overflows, so the rewriter runs once.
            '8': first ? 'an overlong label text' : 'Speed',
          },
          speakerNotes: '',
          visual: null,
        });
      },
    };
    const result = await runLabel(provider);
    // All three variants are mandatory, so a slot the model cannot shorten costs a warning,
    // not the whole deck.
    expect(result.status).toBe('success');
    expect(calls).toBe(5);
    // Every draw after the first carries the accumulated feedback.
    for (const input of inputs.slice(1)) {
      expect((input as { feedback?: string }).feedback).toMatch(/не длиннее/);
    }
    if (result.status !== 'success') return;
    const first = result.result[0];
    expect(first?.slide.texts.find((t) => t.slotId === '8')?.text).toBe('an overlong label text');
    for (const written of result.result.slice(1))
      expect(written.slide.texts.find((t) => t.slotId === '8')?.text).toBe('Speed');
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

  it('drops a chart where every value is the same', () => {
    expect(
      groundedVisual({ ...chart, series: [{ name: 'Индекс', values: [1, 1, 1] }] }, brief),
    ).toBeNull();
  });

  it('reads a figure with a thousands space as one number', () => {
    const sensors = { ...chart, series: [{ name: 'Датчики', values: [1, 800, 10] }] };
    expect(groundedVisual(sensors, 'Установлено 1 800 датчиков за 10 месяцев.')).toBeNull();
    expect(
      groundedVisual(
        { ...sensors, series: [{ name: 'Датчики', values: [1800, 10, 12] }] },
        'Установлено 1 800 датчиков за 10 месяцев, 12 домов.',
      ),
    ).not.toBeNull();
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

  it('reads the highest of equal step headings as a heading and the large claim as the title', () => {
    // Steps: a number and a heading each; the first heading sits highest and was read as the
    // title, while the slide's claim is set large in a body slot.
    const heading = (slotId: string, y: number, role: 'title' | 'body') => ({
      ...card(slotId, 'Работа', 120, y),
      role,
      fontSize: 30,
      box: { x: 120, y, cx: 400, cy: 48 },
    });
    const claim = { ...card('claim', 'Несколько этапов процесса', 700, 0), fontSize: 75 };
    const steps = {
      ...composition,
      slots: [
        heading('h1', 0, 'title'),
        card('c1', '01', 0, 0),
        heading('h2', 100, 'body'),
        card('c2', '02', 0, 100),
        claim,
      ],
    };
    const read = withCardHeadings(steps);
    expect(read.slots.filter((s) => s.role === 'title').map((s) => s.slotId)).toEqual(['claim']);
    expect(read.slots.find((s) => s.slotId === 'h1')?.role).toBe('body');
    expect(Object.fromEntries(numberedSlots(read))).toEqual({ c1: '01', c2: '02' });
    // A title unlike every body slot stays the title.
    const plain = { ...steps, slots: [heading('h1', 0, 'title'), claim] };
    expect(withCardHeadings(plain)).toBe(plain);
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

  const today = new Date(2026, 8, 29);

  it('flags a past year the brief does not name, and passes one it does', () => {
    const pattern = { ...composition, slots: [slot('a', 80, 2)] };
    const brief = 'Пилот запущен в 2025 году.';
    expect(
      copyDefects(slide({ a: 'Итоги 2024 года' }), pattern, { brief, today }).get('a'),
    ).toMatch(/2024/);
    expect(copyDefects(slide({ a: 'Пилот 2025 года' }), pattern, { brief, today }).size).toBe(0);
    expect(copyDefects(slide({ a: 'План на 2026' }), pattern, { brief, today }).size).toBe(0);
  });

  it("flags a field left with the template's label unless the brief says it", () => {
    const label = { ...slot('a', 40, 1), sample: 'Контакт' };
    const pattern = { ...composition, slots: [label] };
    expect(copyDefects(slide({ a: 'Контакт' }), pattern, { brief: 'Офисы' }).has('a')).toBe(true);
    expect(copyDefects(slide({ a: 'hr@green.office' }), pattern, { brief: 'Офисы' }).size).toBe(0);
    expect(
      copyDefects(slide({ a: 'Контакт' }), pattern, { brief: 'Раздел «Контакт» для клиентов' })
        .size,
    ).toBe(0);
    expect(clearEchoes(slide({ a: 'Контакт' }), pattern, 'Офисы').texts).toEqual([
      { slotId: 'a', text: '' },
    ]);
    // A speaker field the writer labelled instead of filling is a label too.
    const speaker = { ...composition, slots: [{ ...slot('a', 40, 1), sample: 'Спикер' }] };
    expect(copyDefects(slide({ a: 'Контакт' }), speaker, { brief: 'Офисы' }).has('a')).toBe(true);
    expect(copyDefects(slide({ a: 'Анна Петрова' }), speaker, { brief: 'Офисы' }).size).toBe(0);
  });

  it('keeps in a speaker or contact field only what the brief states', () => {
    const speaker = { ...slot('s', 40, 1), sample: 'Спикер' };
    const body = slot('b', 80, 2);
    const pattern = { ...composition, slots: [speaker, body] };
    const brief = 'Докладчик: Анна Петрова, отдел продаж';
    expect(
      keepStatedFacts(slide({ s: 'Контакт', b: 'Озеленение офиса' }), pattern, brief).texts,
    ).toEqual([
      { slotId: 's', text: '' },
      { slotId: 'b', text: 'Озеленение офиса' },
    ]);
    expect(keepStatedFacts(slide({ s: 'Анна Петрова', b: 'x' }), pattern, brief).texts[0]).toEqual({
      slotId: 's',
      text: 'Анна Петрова',
    });
    // An empty speaker field is not a card to fill.
    expect(emptySlots(slide({ s: '', b: 'Озеленение' }), pattern)).toEqual([]);
  });

  it('flags a bare number in a field whose sample is words', () => {
    const pattern = { ...composition, slots: [{ ...slot('a', 40, 1), sample: 'Работа' }] };
    expect(copyDefects(slide({ a: '05' }), pattern).has('a')).toBe(true);
    expect(copyDefects(slide({ a: 'Монтаж' }), pattern).size).toBe(0);
  });

  it('flags a list that opens with the heading of its card, not one that opens with a point', () => {
    const heading = { ...slot('h', 40, 1), box: { x: 0, y: 0, cx: 300, cy: 40 } };
    const list = { ...slot('l', 200, 6), box: { x: 0, y: 60, cx: 300, cy: 240 } };
    const other = { ...slot('o', 40, 1), box: { x: 400, y: 0, cx: 300, cy: 40 } };
    const pattern = { ...composition, slots: [heading, list, other] };
    const defects = copyDefects(
      slide({ h: 'Результат', l: 'Результаты\nЗелень\nАвтополив', o: 'Исходная точка' }),
      pattern,
    );
    expect([...defects.keys()]).toEqual(['l']);
    expect(
      copyDefects(
        slide({ h: 'Результат', l: 'Зелень\nАвтополив\nБодрость', o: 'Исходная точка' }),
        pattern,
      ).size,
    ).toBe(0);
    expect(repeatsHeading('Исходная точка', 'Точка отсчёта')).toBe(true);
  });
});

describe('dates', () => {
  const base = composition.slots[0];
  if (!base) throw new Error('Fixture slot missing');
  const field = (slotId: string, sample: string) => ({
    ...base,
    slotId,
    role: 'body' as const,
    sample,
  });
  const today = new Date(2026, 8, 29);

  it("dates a date field today in the sample's format and keeps it from the writer", () => {
    const pattern = {
      ...composition,
      slots: [
        field('y', '2024'),
        field('d', '12.05.2024'),
        field('m', 'Май 2023'),
        field('f', 'Дата'),
        field('t', 'B2B-услуги'),
      ],
    };
    expect(Object.fromEntries(datedSlots(pattern, { brief: 'Озеленение', today }))).toEqual({
      y: '2026',
      d: '29.09.2026',
      m: 'Сентябрь 2026',
      f: '2026',
    });
    expect(writerSlots(pattern).map((slot) => slot.slotId)).toContain('t');
    expect(writerSlots(pattern).map((slot) => slot.slotId)).not.toContain('y');
  });

  it('takes the year from the brief when it plans ahead, never an old one', () => {
    expect(deckYear('Стратегия на 2027 год', today)).toBe(2027);
    expect(deckYear('С 2019 года на рынке', today)).toBe(2026);
    const pattern = { ...composition, slots: [field('d', '12.05.2024')] };
    expect(datedSlots(pattern, { brief: 'План на 2027', today }).get('d')).toBe('2027');
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

  it('hands the plan it made to be kept, once', async () => {
    const plan = { audience: '', goal: '', title: 'T', slides: [] };
    const kept = vi.fn(() => Promise.resolve());
    const shared = new SharedPlan(undefined, kept);
    await Promise.all([
      shared.once(() => Promise.resolve(plan)),
      shared.once(() => Promise.resolve(plan)),
    ]);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledWith(plan);
  });

  it('tells a rebuilt variant the plan its build kept, without planning again', async () => {
    const plan = { audience: '', goal: '', title: 'Kept', slides: [] };
    const compute = vi.fn(() => Promise.resolve({ ...plan, title: 'New' }));
    await expect(new SharedPlan(plan).once(compute)).resolves.toBe(plan);
    expect(compute).not.toHaveBeenCalled();
  });

  it('does not accept a plan whose persistence failed', async () => {
    const plan = { audience: '', goal: '', title: 'T', slides: [] };
    const shared = new SharedPlan(undefined, () => Promise.reject(new Error('disk full')));
    await expect(shared.once(() => Promise.resolve(plan))).rejects.toThrow('disk full');
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
    // Each dense slide holds at least as much as its airy twin, and the deck holds more.
    let denser = 0;
    let lighter = 0;
    for (let i = 1; i < planned.length; i += 1) {
      expect(capacity(dense[i] ?? '')).toBeGreaterThanOrEqual(capacity(airy[i] ?? ''));
      denser += capacity(dense[i] ?? '');
      lighter += capacity(airy[i] ?? '');
    }
    expect(denser).toBeGreaterThan(lighter);
    expect(dense[4]?.startsWith('two-')).toBe(true);
    expect(airy[4]?.startsWith('two-')).toBe(true);
  });

  it('keeps an airy slide on a layout that still holds most of the planned text', () => {
    const catalog = variantCatalog(full, 'airy', [cover]);
    const layouts = remapPlan(['cover', 'one-900'], full, catalog, 'airy', [cover]);
    const room = full
      .find((p) => p.patternId === layouts[1])
      ?.slots.reduce((sum, s) => sum + (s.role === 'body' ? s.maxChars : 0), 0);
    expect(room).toBeGreaterThanOrEqual(540);
    expect(room).toBeLessThanOrEqual(900);
  });

  it('never lays a content slide out on a divider or a closing, nor on a far block count', () => {
    const note = (patternId: string, kind: CompositionNote['kind']) =>
      [
        patternId,
        {
          patternId,
          kind,
          items: 1,
          useFor: '',
          title: '',
          skip: false,
          special: false,
          requiredContent: [] as CompositionNote['requiredContent'],
        },
      ] as const;
    // The lightest one-block layouts are a divider and a closing: airy would take them.
    const notes = new Map<string, CompositionNote>([
      note('one-150', 'section'),
      note('one-300', 'closing'),
      note('one-450', 'statement'),
      note('one-600', 'statement'),
      note('one-900', 'statement'),
      note('one-1200', 'statement'),
    ]);
    const four = composition('four', [100, 100, 100, 100]);
    const catalog = variantCatalog([...full, four], 'airy', [cover]);
    const layouts = remapPlan(
      ['cover', 'one-450', 'four', 'one-150'],
      [...full, four],
      catalog,
      'airy',
      [cover],
      notes,
    );
    expect(['one-450', 'one-600', 'one-900', 'one-1200']).toContain(layouts[1]);
    // No other layout of four or of three to five blocks: the slide keeps its own.
    expect(layouts[2]).toBe('four');
    expect(['one-150', 'one-300']).toContain(layouts[3]);
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

  it('borrows one block in density mode and keeps the planned count when asked', () => {
    const note = (patternId: string, kind: CompositionNote['kind'] = 'statement') =>
      [
        patternId,
        {
          patternId,
          kind,
          items: 1,
          useFor: 'one point',
          title: patternId,
          skip: false,
          special: false,
          requiredContent: [] as CompositionNote['requiredContent'],
        },
      ] as const;
    const one = composition('one-450', [450]);
    const two = composition('two-200', [200, 200]);
    const three = composition('three-300', [300, 300, 300]);
    const notes = new Map([note('one-450'), note('two-200'), note('three-300')]);
    const fewer = ['cover', 'two-200'];
    const fewerFull = [cover, one, two];
    expect(remapPlan(fewer, fewerFull, [cover, one], 'dense', [cover], notes)).toEqual([
      'cover',
      'one-450',
    ]);
    expect(
      remapPlan(fewer, fewerFull, [cover, one], 'dense', [cover], notes, 'preserve-block-count'),
    ).toEqual(fewer);
    expect(remapPlan(fewer, fewerFull, [cover, one], 'dense', [cover], notes, 'density')).toEqual([
      'cover',
      'one-450',
    ]);
    const more = ['cover', 'two-200'];
    const moreFull = [cover, two, three];
    expect(remapPlan(more, moreFull, [cover, three], 'dense', [cover], notes)).toEqual([
      'cover',
      'three-300',
    ]);
    expect(
      remapPlan(more, moreFull, [cover, three], 'dense', [cover], notes, 'preserve-block-count'),
    ).toEqual(more);
  });

  it('still changes a layout that has the same number of content blocks', () => {
    const plan = ['cover', 'one-450'];
    const dense = remapPlan(
      plan,
      full,
      variantCatalog(full, 'dense', [cover]),
      'dense',
      [cover],
      new Map(),
      'preserve-block-count',
    );
    expect(dense[1]).not.toBe('one-450');
    expect(dense[1]?.startsWith('one-')).toBe(true);
  });

  it('does not count numbering or a mirrored copy as a content block', () => {
    const slot = (
      slotId: string,
      role: 'title' | 'body',
      sample: string,
      box: { x: number; y: number; cx: number; cy: number },
    ) => ({
      slotId,
      role,
      sample,
      maxChars: 40,
      maxLines: 1,
      font: 'A',
      fontSize: role === 'title' ? 30 : 16,
      box,
    });
    const numbered = {
      ...composition('numbered', [40]),
      slots: [
        slot('t', 'title', '', { x: 0, y: 0, cx: 400, cy: 40 }),
        slot('n1', 'body', '01', { x: 0, y: 80, cx: 40, cy: 20 }),
        slot('n2', 'body', '02', { x: 200, y: 80, cx: 40, cy: 20 }),
        slot('b', 'body', 'Point', { x: 50, y: 80, cx: 140, cy: 40 }),
      ],
    };
    const mirror = {
      ...composition('mirror', [40]),
      slots: [
        slot('t', 'title', '', { x: 0, y: 0, cx: 400, cy: 40 }),
        slot('a', 'body', 'Same', { x: 0, y: 80, cx: 180, cy: 40 }),
        slot('b', 'body', 'Same', { x: 0, y: 80, cx: 180, cy: 40 }),
      ],
    };
    const one = composition('one-450', [450]);
    const catalog = [cover, numbered, mirror, one];
    expect(
      remapPlan(
        ['cover', 'numbered'],
        catalog,
        catalog,
        'dense',
        [cover],
        new Map(),
        'preserve-block-count',
      )[1],
    ).toBe('one-450');
    expect(
      remapPlan(
        ['cover', 'mirror'],
        catalog,
        catalog,
        'dense',
        [cover],
        new Map(),
        'preserve-block-count',
      )[1],
    ).toBe('one-450');
  });

  it('keeps cover, special, framing and required-content guards under the strict policy', () => {
    const note = (
      patternId: string,
      kind: CompositionNote['kind'],
      extra: Partial<CompositionNote> = {},
    ) =>
      [
        patternId,
        {
          patternId,
          kind,
          items: 1,
          useFor: kind,
          title: patternId,
          skip: false,
          special: false,
          requiredContent: [] as CompositionNote['requiredContent'],
          ...extra,
        },
      ] as const;
    const special = composition('special-one', [900]);
    const section = composition('section-one', [150]);
    const named = composition('named-one', [900]);
    const ordinary = composition('one-450', [450]);
    const catalog = [cover, special, section, named, ordinary, composition('one-1200', [1200])];
    const notes = new Map<string, CompositionNote>([
      note('cover', 'cover'),
      note('special-one', 'statement', { special: true }),
      note('section-one', 'section'),
      note('named-one', 'statement', { requiredContent: ['person-name'] }),
      note('one-450', 'statement'),
      note('one-1200', 'statement'),
    ]);
    const plan = ['cover', 'special-one', 'section-one', 'one-450'];
    expect(
      remapPlan(plan, catalog, catalog, 'dense', [cover], notes, 'preserve-block-count'),
    ).toEqual(['cover', 'special-one', 'section-one', 'one-1200']);
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

  it('moves a slide whose layout needs a missing name to a free layout, keeping the rest', () => {
    const layout = (patternId: string) => ({
      ...composition,
      patternId,
      slots: composition.slots.map((slot) => ({ ...slot })),
    });
    const catalog = [layout('speaker'), layout('statement'), layout('quote')];
    const withKinds = new Map<string, CompositionNote>([
      ...notes,
      ...(['statement', 'quote'] as const).map(
        (id) =>
          [
            id,
            {
              patternId: id,
              kind: 'statement' as const,
              items: 1,
              useFor: '',
              title: '',
              skip: false,
              special: false,
              requiredContent: [] as CompositionNote['requiredContent'],
            },
          ] as const,
      ),
    ]);
    const source = 'Пилот прошёл в четырёх районах.';
    const planned = plan('Анна Иванова');
    const fixed = withoutMissingContent(
      planned,
      missingRequiredContent(planned, withKinds, source),
      catalog,
      withKinds,
      false,
    );
    expect(fixed.slides[1]?.patternId).not.toBe('speaker');
    expect(missingRequiredContent(fixed, withKinds, source)).toEqual([]);
    expect(fixed.slides.filter((_, index) => index !== 1)).toEqual(
      planned.slides.filter((_, index) => index !== 1),
    );
    // Nothing missing: the plan is left as it is.
    expect(withoutMissingContent(planned, [], catalog, withKinds, false)).toBe(planned);
  });
});

describe('keepOutline', () => {
  it('keeps approved points even when the planner already repeated the title', () => {
    const kept = keepOutline(
      {
        title: 'Plan',
        audience: '',
        goal: '',
        slides: [
          { patternId: 'a', purpose: 'Гарантия действует', imageQuery: '', sourceEvidence: {} },
        ],
      },
      {
        title: 'Approved',
        audience: '',
        goal: '',
        slides: [
          {
            title: 'Гарантия действует',
            points: ['Только при предоплате до 15 октября', 'Стоимость 50 рублей'],
            kind: 'statement',
          },
        ],
      },
    );
    expect(kept.slides[0]?.purpose).toContain('Только при предоплате до 15 октября');
    expect(kept.slides[0]?.purpose).toContain('Стоимость 50 рублей');
  });
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

describe('text blocks too thin for their box', () => {
  const sample = [
    'здесь текст в две строки или более (любые детали проекта)',
    'ещё строка',
    'и ещё одна',
  ].join('\n');
  const block = {
    slotId: 'b',
    role: 'body' as const,
    sample,
    maxChars: 672,
    maxLines: 16,
    font: 'Play',
    fontSize: 16,
  };
  const label = { ...block, slotId: 'l', sample: 'Подпись', maxChars: 40, maxLines: 1 };
  const pattern = {
    patternId: 'two-columns',
    sourceIndex: 23,
    name: 'Две колонки',
    slots: [block, label],
    imageCount: 0,
  };
  const slide = (text: string) => ({
    patternId: 'two-columns',
    speakerNotes: '',
    texts: [
      { slotId: 'b', text },
      { slotId: 'l', text: 'Итог' },
    ],
  });

  it('gives a multi-line block a floor by variant and a label none', () => {
    expect(minChars(block, 'dense')).toBeGreaterThan(minChars(block, 'balanced'));
    expect(minChars(block, 'balanced')).toBeGreaterThan(minChars(block, 'airy'));
    expect(minChars(block, 'airy')).toBeGreaterThan(0);
    expect(minChars(label, 'dense')).toBe(0);
  });

  it('sends a block with one short line back for more, and passes a full one', () => {
    const thin = copyDefects(slide('Подключено: 320 зданий'), pattern, { variant: 'balanced' });
    expect(thin.get('b')).toMatch(/looks empty/);
    const full = Array.from(
      { length: 4 },
      () => 'Датчики в каждом подъезде передают показания в диспетчерскую без обходов',
    )
      .map((line, index) => `${line} ${index + 1}`)
      .join('\n');
    expect(copyDefects(slide(full), pattern, { variant: 'balanced' }).has('b')).toBe(false);
    // Without a variant nothing is measured, as for the old callers.
    expect(copyDefects(slide('Подключено: 320 зданий'), pattern).has('b')).toBe(false);
  });
});
