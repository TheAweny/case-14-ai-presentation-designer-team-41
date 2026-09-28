import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  composedSlideSchema,
  compositionPlanSchema,
  templateSlotCopySchema,
  slotChartSchema,
  slotRewriteChoicesSchema,
  slotTableSchema,
  type SlotVisual,
  compositionSchema,
  generationProfileSchema,
  type ComposedSlide,
  type GenerationProfile,
} from '@lct/contracts';
import type { TextProvider } from './provider.js';
export { compositionPlanSchema, compositionCritiqueSchema as critiqueSchema } from '@lct/contracts';

/** The three renderings of one brief. They differ in composition and density, not in facts. */
export type DeckVariant = 'dense' | 'balanced' | 'airy';

export interface GenerationDependencies {
  provider: TextProvider;
  /** Which rendering to plan and write. Absent: balanced. */
  variant?: DeckVariant;
  plannerInstructions: string;
  writerInstructions: string;
  repairInstructions?: string;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
}
const inputSchema = z.object({
  brief: z.string(),
  slideCount: z.number().int().min(10).max(15).nullable(),
  profile: generationProfileSchema,
});
const taskSchema = z.object({
  narrative: z.array(z.string()).default([]),
  index: z.number(),
  total: z.number(),
  title: z.string(),
  brief: z.string(),
  purpose: z.string(),
  imageQuery: z.string(),
  composition: compositionSchema,
});
export const writtenSchema = z.object({
  index: z.number(),
  title: z.string(),
  slide: composedSlideSchema,
  imageQuery: z.string(),
});

/** Body slots roomy enough to hold a table or a chart instead of their text. */
const VISUAL_MIN_CHARS = 120;

/**
 * How many characters already fitted this slot in the template.
 * `maxChars` is a font-metric ceiling and is often wider than the visible shape, so a title
 * written to that ceiling is clipped by a pill or runs into the next card. The sample is the
 * phrase the template itself set in the box. Stay near it, and let a title grow only as far as
 * a short assertion.
 */
export function fitChars(slot: { role: string; sample: string; maxChars: number }): number {
  const sampleLen = slot.sample.trim().length;
  if (sampleLen === 0) return slot.maxChars;
  const scaled = Math.ceil(sampleLen * 1.25);
  const floor = Math.min(slot.maxChars, slot.role === 'title' ? 36 : 8);
  return Math.max(4, Math.min(slot.maxChars, Math.max(scaled, floor)));
}

/**
 * How often one template composition may be reused. Two compositions cannot cover ten slides
 * without repetition. A richer catalog must not be cloned into the same diagram five times.
 */
export function patternUseLimit(patternCount: number, slideCount: number): number {
  if (patternCount <= 2) return Math.max(3, Math.ceil(slideCount / Math.max(1, patternCount)));
  return 2;
}

/** Reading order of a composition's slots. Row and column are indexes, not coordinates. */
export function slotBriefs(slots: GenerationProfile['compositions'][number]['slots']) {
  const heights = slots
    .map((slot) => slot.box?.cy ?? 0)
    .filter((height) => height > 0)
    .sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const gap = median > 0 ? median * 0.5 : Number.POSITIVE_INFINITY;
  const ordered = [...slots].sort(
    (a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0) || (a.box?.x ?? 0) - (b.box?.x ?? 0),
  );
  let row = 0;
  let rowTop = ordered[0]?.box?.y ?? 0;
  const nextColumn = new Map<number, number>();
  return ordered.map((slot) => {
    const y = slot.box?.y ?? rowTop;
    if (y - rowTop > gap) {
      row += 1;
      rowTop = y;
    }
    const column = nextColumn.get(row) ?? 0;
    nextColumn.set(row, column + 1);
    return {
      slotId: slot.slotId,
      role: slot.role,
      sample: slot.sample,
      maxChars: slot.maxChars,
      maxLines: slot.maxLines,
      fontSize: slot.fontSize,
      fitChars: fitChars(slot),
      row,
      column,
    };
  });
}

export function visualSlots(pattern: GenerationProfile['compositions'][number]): string[] {
  return pattern.slots
    .filter((slot) => slot.role === 'body' && slot.maxChars >= VISUAL_MIN_CHARS)
    .map((slot) => slot.slotId);
}

function boundedSlideSchema(pattern: GenerationProfile['compositions'][number]) {
  const slots = visualSlots(pattern);
  const visual = slots.length
    ? z
        .union([
          slotTableSchema.extend({ slotId: z.enum(slots as [string, ...string[]]) }),
          slotChartSchema.extend({ slotId: z.enum(slots as [string, ...string[]]) }),
        ])
        .nullable()
        .default(null)
    : z.null().default(null);
  return templateSlotCopySchema.extend({
    patternId: z.literal(pattern.patternId),
    textsBySlot: z.object(
      Object.fromEntries(
        pattern.slots.map((slot) => [slot.slotId, z.string().min(slot.role === 'title' ? 1 : 0)]),
      ),
    ),
    speakerNotes: z.string(),
    visual,
  });
}

const FIGURE = /\d+(?:[.,]\d+)?/g;

/**
 * A visual only when every figure in it is in the brief: a chart is where an invented number
 * would do most harm, so a visual that cannot be traced to the source is dropped and the slot
 * keeps its text.
 */
export function groundedVisual(
  visual: SlotVisual | null | undefined,
  brief: string,
): SlotVisual | null {
  if (!visual) return null;
  const known = new Set((brief.match(FIGURE) ?? []).map((n) => Number(n.replace(',', '.'))));
  const figures =
    visual.kind === 'chart'
      ? visual.series.flatMap((series) => series.values)
      : visual.rows
          .flat()
          .flatMap((cell) => (cell.match(FIGURE) ?? []).map((n) => Number(n.replace(',', '.'))));
  if (
    visual.kind === 'chart' &&
    visual.series.some((s) => s.values.length !== visual.categories.length)
  )
    return null;
  if (visual.kind === 'table' && visual.rows.some((row) => row.length !== visual.headers.length))
    return null;
  return figures.length > 0 && figures.every((n) => known.has(n)) ? visual : null;
}

function writingComposition(pattern: GenerationProfile['compositions'][number]) {
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    imageCount: pattern.imageCount,
    slots: slotBriefs(pattern.slots),
  };
}

export function createGenerationWorkflow(deps: GenerationDependencies) {
  let completed = 0;
  const plan = createStep({
    id: 'plan-compositions',
    inputSchema,
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
      const spacious = inputData.profile.compositions.filter(
        (p) =>
          p.slots.some((s) => s.role === 'title' && s.maxChars >= 25) &&
          p.slots.every((s) => s.maxChars >= 12),
      );
      const full = spacious.length ? spacious : inputData.profile.compositions;
      const variant = deps.variant ?? 'balanced';
      const titleSizes = full
        .flatMap((p) => p.slots.filter((s) => s.role === 'title').map((s) => s.fontSize))
        .sort((a, b) => a - b);
      const typicalTitle = titleSizes[Math.floor(titleSizes.length / 2)] ?? 24;
      const coversOf = (list: typeof full) =>
        list.filter(
          (p) =>
            p.slots.length <= 3 &&
            p.slots.some((s) => s.role === 'title' && s.fontSize > typicalTitle),
        );
      const covers = coversOf(full);
      const catalog = variantCatalog(full, variant, covers);
      const plan = (
        corrections?: Record<string, unknown>,
        previous?: z.infer<typeof compositionPlanSchema>,
      ) =>
        deps.provider.generate(
          'planner',
          deps.plannerInstructions,
          {
            brief: inputData.brief,
            slideCount: inputData.slideCount,
            variant,
            catalog,
            coverPatternIds: covers.map((p) => p.patternId),
            ...(previous ? { previous } : {}),
            ...(corrections ? { corrections } : {}),
          },
          compositionPlanSchema,
          deps.signal,
        );
      const countCorrections = (result: z.infer<typeof compositionPlanSchema>) =>
        inputData.slideCount === null || result.slides.length === inputData.slideCount
          ? undefined
          : {
              exactSlideCount: inputData.slideCount,
              returnedSlideCount: result.slides.length,
              message: 'Return exactly exactSlideCount slides.',
            };
      const coverCorrections = (result: z.infer<typeof compositionPlanSchema>) =>
        result.slides.length > 1 &&
        covers.length &&
        !covers.some((p) => p.patternId === result.slides[0]?.patternId)
          ? { firstSlidePatternMustBeOneOf: covers.map((p) => p.patternId) }
          : undefined;
      let result: z.infer<typeof compositionPlanSchema>;
      try {
        result = await plan();
      } catch {
        result = await plan({
          minimumSlideCount: 10,
          exactSlideCount: inputData.slideCount,
          message: 'Return 10 to 60 slides in auto mode, or exactly the requested count.',
        });
      }
      // One layout repeated over most of the deck reads as the same slide again and again; the
      // planner gets the overused ids and replans once.
      const varietyCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
        const counts = new Map<string, number>();
        for (const slide of result.slides) {
          counts.set(slide.patternId, (counts.get(slide.patternId) ?? 0) + 1);
        }
        const limit = patternUseLimit(catalog.length, result.slides.length);
        const overused = [...counts].filter(([, n]) => n > limit).map(([id]) => id);
        return overused.length && catalog.length > 1
          ? {
              overusedPatternIds: overused,
              maximumUsesPerPattern: limit,
              message:
                'Use each composition at most maximumUsesPerPattern times; vary the layouts.',
            }
          : undefined;
      };
      const corrections = {
        ...countCorrections(result),
        ...coverCorrections(result),
        ...varietyCorrections(result),
      };
      if (Object.keys(corrections).length) result = await plan(corrections, result);
      if (inputData.slideCount !== null && result.slides.length !== inputData.slideCount)
        throw new Error('Planner returned the wrong slide count.');
      if (coverCorrections(result)) throw new Error('Planner did not select a cover composition.');
      return result.slides.map((slide, index) => {
        const composition = inputData.profile.compositions.find(
          (p) => p.patternId === slide.patternId,
        );
        if (!composition) throw new Error('Planner selected an unknown template composition.');
        return {
          ...slide,
          narrative: result.slides.map((s) => s.purpose),
          index,
          total: result.slides.length,
          title: result.title,
          brief: inputData.brief,
          composition,
        };
      });
    },
  });
  const write = createStep({
    id: 'write-template-slide',
    inputSchema: taskSchema,
    outputSchema: writtenSchema,
    execute: async ({ inputData }) => {
      let slide: ComposedSlide | undefined;
      let problems: string[] = [];
      const raw = await deps.provider.generate(
        'writer',
        deps.writerInstructions,
        {
          ...inputData,
          variant: deps.variant ?? 'balanced',
          composition: writingComposition(inputData.composition),
          visualSlots: visualSlots(inputData.composition),
        },
        boundedSlideSchema(inputData.composition),
        deps.signal,
      );
      const visual = groundedVisual(raw.visual as SlotVisual | null, inputData.brief);
      slide = {
        patternId: raw.patternId,
        speakerNotes: raw.speakerNotes,
        // The slot a visual replaces carries no text: the export removes it.
        texts: Object.entries(raw.textsBySlot).map(([slotId, text]) => ({
          slotId,
          text: visual?.slotId === slotId ? '' : text,
        })),
        visual,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        problems = validateBindings(slide, inputData.composition);
        if (!problems.length) break;
        slide = await rewriteSlide(deps, {
          index: inputData.index,
          brief: inputData.brief,
          composition: inputData.composition,
          previous: slide,
          corrections: inputData.composition.slots
            .filter((slot) => {
              const text = slide?.texts.find((t) => t.slotId === slot.slotId)?.text ?? '';
              return (
                text.length > fitChars(slot) ||
                text.length > slot.maxChars ||
                text.split('\n').length > slot.maxLines ||
                (slot.role === 'title' && !text.trim())
              );
            })
            .map((slot) => ({
              slotId: slot.slotId,
              message: `Maximum ${fitChars(slot)} characters and ${slot.maxLines} lines. The template sample was ${slot.sample.length} characters.`,
            })),
        });
        problems = validateBindings(slide, inputData.composition);
      }
      if (!slide || problems.length)
        throw new Error(`Slide ${inputData.index + 1}: ${problems.join('; ')}`);
      completed++;
      await deps.onProgress?.(completed, inputData.total);
      return {
        index: inputData.index,
        title: inputData.title,
        slide,
        imageQuery: inputData.imageQuery,
      };
    },
  });
  return createWorkflow({
    id: 'generate-template-deck',
    inputSchema,
    outputSchema: z.array(writtenSchema),
  })
    .then(plan)
    .foreach(write, { concurrency: Math.max(1, Math.min(6, deps.concurrency ?? 3)) })
    .commit();
}
/**
 * The compositions a variant plans with. Dense takes the two thirds of the template's layouts
 * that hold the most text, airy the two thirds that hold the least, balanced all of them; covers
 * stay in every set. The catalog differs, so the three decks differ in layout even where the
 * model would pick the same one, and every layout still comes from the template.
 */
export function variantCatalog<T extends GenerationProfile['compositions'][number]>(
  catalog: readonly T[],
  variant: DeckVariant,
  covers: readonly T[] = [],
): T[] {
  if (variant === 'balanced' || catalog.length < 3) return [...catalog];
  const capacity = (p: T) =>
    p.slots.filter((s) => s.role === 'body').reduce((sum, s) => sum + s.maxChars, 0);
  const ranked = [...catalog].sort((a, b) => capacity(b) - capacity(a));
  const keep = Math.ceil((ranked.length * 2) / 3);
  const chosen = variant === 'dense' ? ranked.slice(0, keep) : ranked.slice(-keep);
  for (const cover of covers) if (!chosen.includes(cover)) chosen.push(cover);
  return chosen;
}

export function validateBindings(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): string[] {
  const errors: string[] = [];
  if (slide.patternId !== pattern.patternId) errors.push('Use the selected patternId');
  if (
    slide.texts.length !== pattern.slots.length ||
    new Set(slide.texts.map((t) => t.slotId)).size !== slide.texts.length
  )
    errors.push('Bind every slot exactly once');
  for (const slot of pattern.slots) {
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    if (!binding) errors.push(`Missing slot ${slot.slotId}`);
    else if (slot.role === 'title' && !binding.text.trim())
      errors.push(`Title ${slot.slotId} must not be empty`);
    else if (
      binding.text.length > fitChars(slot) ||
      binding.text.length > slot.maxChars ||
      binding.text.split('\n').length > slot.maxLines
    )
      errors.push(
        `Shorten slot ${slot.slotId} to <= ${fitChars(slot)} chars and ${slot.maxLines} lines`,
      );
  }
  return errors;
}

export const repairTaskSchema = z.object({
  index: z.number(),
  brief: z.string(),
  composition: compositionSchema,
  previous: composedSlideSchema,
  corrections: z.array(z.object({ slotId: z.string(), message: z.string() })),
});
export const repairedSlideSchema = z.object({ index: z.number(), slide: composedSlideSchema });

export function createRepairWorkflow(deps: GenerationDependencies) {
  const start = createStep({
    id: 'repair-input',
    inputSchema: z.array(repairTaskSchema),
    outputSchema: z.array(repairTaskSchema),
    execute: async ({ inputData }) => inputData,
  });
  const repair = createStep({
    id: 'repair-template-slide',
    inputSchema: repairTaskSchema,
    outputSchema: repairedSlideSchema,
    execute: async ({ inputData }) => {
      const slide = await rewriteSlide(deps, inputData);
      const problems = validateBindings(slide, inputData.composition);
      if (problems.length) throw new Error(`Repair ${inputData.index + 1}: ${problems.join('; ')}`);
      return { index: inputData.index, slide };
    },
  });
  return createWorkflow({
    id: 'repair-template-deck',
    inputSchema: z.array(repairTaskSchema),
    outputSchema: z.array(repairedSlideSchema),
  })
    .then(start)
    .foreach(repair, { concurrency: deps.concurrency ?? 3 })
    .commit();
}

async function rewriteSlide(
  deps: GenerationDependencies,
  task: z.infer<typeof repairTaskSchema>,
): Promise<ComposedSlide> {
  const slots = task.composition.slots.filter((s) =>
    task.corrections.some((c) => c.slotId === s.slotId),
  );
  if (!slots.length) return task.previous;
  const schema = slotRewriteChoicesSchema.extend({
    rewrites: z.object(
      Object.fromEntries(slots.map((s) => [s.slotId, z.array(z.string()).length(3)])),
    ),
  });
  const result = await deps.provider.generate(
    'rewriter',
    deps.repairInstructions ?? deps.writerInstructions,
    {
      brief: task.brief,
      slots: slots.map((s) => ({
        slotId: s.slotId,
        role: s.role,
        sample: s.sample,
        maxChars: s.maxChars,
        fitChars: fitChars(s),
        maxLines: s.maxLines,
        text: task.previous.texts.find((t) => t.slotId === s.slotId)?.text,
        correction: task.corrections
          .filter((c) => c.slotId === s.slotId)
          .map((c) => c.message)
          .join('; '),
      })),
    },
    schema,
    deps.signal,
  );
  const slide = { ...task.previous, texts: task.previous.texts.map((t) => ({ ...t })) };
  for (const slot of slots) {
    const alternatives = result.rewrites[slot.slotId] ?? [];
    const text = alternatives
      .filter(
        (t) =>
          t.length <= fitChars(slot) &&
          t.length <= slot.maxChars &&
          t.split('\n').length <= slot.maxLines &&
          (slot.role !== 'title' || t.trim()),
      )
      .sort((a, b) => b.length - a.length)[0];
    if (text === undefined)
      throw new Error(
        `No complete rewrite fits slot ${slot.slotId} (${fitChars(slot)} chars; alternatives: ${alternatives.map((t) => t.length).join(',')}).`,
      );
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    if (binding) binding.text = text;
  }
  return slide;
}
