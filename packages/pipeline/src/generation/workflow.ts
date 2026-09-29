import {
  composedSlideSchema,
  compositionPlanSchema,
  compositionSchema,
  deckOutlineSchema,
  generationProfileSchema,
  slotChartSchema,
  slotRewriteChoicesSchema,
  slotTableSchema,
  templateSlotCopySchema,
  type ComposedSlide,
  type CompositionNote,
  type DeckOutline,
  type GenerationProfile,
  type SlotVisual,
} from '@lct/contracts';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { TextProvider } from './provider.js';
export { compositionPlanSchema, compositionCritiqueSchema as critiqueSchema } from '@lct/contracts';

/** The three renderings of one brief. They differ in composition and density, not in facts. */
export type DeckVariant = 'dense' | 'balanced' | 'airy';

export interface GenerationDependencies {
  provider: TextProvider;
  /** Which rendering to lay out and write. Absent: balanced. */
  variant?: DeckVariant;
  /** The one plan the variants of a brief share. Absent: this run plans for itself. */
  sharedPlan?: SharedPlan;
  plannerInstructions: string;
  writerInstructions: string;
  repairInstructions?: string;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
  /** Leftover defects a repair could not cure; reported, never fatal, so every variant finishes. */
  onWarning?: (message: string) => void | Promise<void>;
  /** What the template indexer read about each composition; absent when never indexed. */
  notes?: readonly CompositionNote[];
}
const inputSchema = z.object({
  brief: z.string(),
  slideCount: z.number().int().min(10).max(15).nullable(),
  profile: generationProfileSchema,
  /** The approved story: its slides, in its order, are what the planner lays out. */
  outline: deckOutlineSchema.nullish(),
});
const taskSchema = z.object({
  narrative: z.array(z.string()).default([]),
  index: z.number(),
  total: z.number(),
  audience: z.string().default(''),
  goal: z.string().default(''),
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
export function fitChars(slot: {
  role: string;
  sample: string;
  maxChars: number;
  prompt?: boolean;
}): number {
  const sampleLen = slot.sample.trim().length;
  // A layout prompt names the box but was never sized to it: the box itself is the measure.
  if (sampleLen === 0 || slot.prompt) return slot.maxChars;
  const scaled = Math.ceil(sampleLen * 1.25);
  const floor = Math.min(slot.maxChars, slot.role === 'title' ? 36 : 8);
  return Math.max(4, Math.min(slot.maxChars, Math.max(scaled, floor)));
}

/**
 * How often one template composition may be reused. Two compositions cannot cover ten slides
 * without repetition. A richer catalog must not be cloned into the same diagram five times.
 */
/** The shortest title that still states a claim: «Здоровье — это экономия». */
const SHORT_CLAIM_CHARS = 16;

export function patternUseLimit(patternCount: number, slideCount: number): number {
  if (patternCount <= 2) return Math.max(3, Math.ceil(slideCount / Math.max(1, patternCount)));
  // A limit the catalog cannot meet only makes the planner ignore it: three layouts cannot
  // carry ten slides at two uses each.
  return Math.max(2, Math.ceil(slideCount / patternCount));
}

/**
 * Compositions a plan leans on: used more than `limit` times, or on three slides in a row. Even
 * within the limit, the same layout three times running reads as one slide shown again.
 */
export function overusedPatterns(patternIds: readonly string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const id of patternIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const overused = new Set([...counts].filter(([, n]) => n > limit).map(([id]) => id));
  patternIds.forEach((id, index) => {
    if (index >= 2 && patternIds[index - 1] === id && patternIds[index - 2] === id)
      overused.add(id);
  });
  return [...overused];
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
  const rows = ordered.map((slot) => {
    const y = slot.box?.y ?? rowTop;
    if (y - rowTop > gap) {
      row += 1;
      rowTop = y;
    }
    return { slot, row };
  });
  // Within a row, left to right: slots a few EMU apart in height are still one row, and sorting
  // them by height alone puts the third card first.
  rows.sort(
    (a, b) =>
      a.row - b.row ||
      (a.slot.box?.x ?? 0) - (b.slot.box?.x ?? 0) ||
      (a.slot.box?.y ?? 0) - (b.slot.box?.y ?? 0),
  );
  const nextColumn = new Map<number, number>();
  return rows.map(({ slot, row }) => {
    const column = nextColumn.get(row) ?? 0;
    nextColumn.set(row, column + 1);
    return {
      slotId: slot.slotId,
      role: slot.role,
      sample: slot.sample,
      ...(slot.prompt ? { prompt: true } : {}),
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
  const mirrored = mirroredSlots(pattern);
  return pattern.slots
    .filter(
      (slot) =>
        slot.role === 'body' && slot.maxChars >= VISUAL_MIN_CHARS && !mirrored.has(slot.slotId),
    )
    .map((slot) => slot.slotId);
}

/**
 * Slots stacked exactly on an earlier slot with the same sample: the template drew one line of
 * copy twice. Writing both prints two phrases over each other, so the copy goes to the first
 * slot and the mirror is cleared. The export keeps template text in any shape left unbound, so
 * the mirror stays bound, to an empty string.
 */
export function mirroredSlots(pattern: GenerationProfile['compositions'][number]): Set<string> {
  const seen: GenerationProfile['compositions'][number]['slots'] = [];
  const mirrored = new Set<string>();
  for (const slot of pattern.slots) {
    const box = slot.box;
    const twin =
      box &&
      seen.find(
        (other) =>
          other.sample.trim() === slot.sample.trim() &&
          other.box &&
          other.box.x === box.x &&
          other.box.y === box.y &&
          other.box.cx === box.cx &&
          other.box.cy === box.cy,
      );
    if (twin) mirrored.add(slot.slotId);
    else seen.push(slot);
  }
  return mirrored;
}

/** Slots the writer fills: every slot but mirrors. Each is visible on the slide. */
export function writableSlots(pattern: GenerationProfile['compositions'][number]) {
  const mirrored = mirroredSlots(pattern);
  return pattern.slots.filter((slot) => !mirrored.has(slot.slotId));
}

const NUMBERING = /^\s*(\d{1,2})([.)]?)\s*$/;

/**
 * Numbering slots (`01`, `02` or `1.`, `2.`) and the numbers they get in reading order. The
 * template drew a sequence; a model asked to continue it mixes numbers and labels, so code keeps
 * it. A single number is a section mark, not a sequence, and stays with the writer.
 */
export function numberedSlots(pattern: GenerationProfile['compositions'][number]) {
  const slots = writableSlots(pattern).filter(
    (slot) => slot.role !== 'title' && NUMBERING.test(slot.sample),
  );
  const numbers = new Map<string, string>();
  if (slots.length < 2) return numbers;
  slotBriefs(slots).forEach((slot, index) => {
    const [, digits = '', suffix = ''] = NUMBERING.exec(slot.sample) ?? [];
    const value = String(index + 1).padStart(digits.length, '0');
    numbers.set(slot.slotId, value + suffix);
  });
  return numbers;
}

/** Slots whose copy the model writes: everything visible but mirrors and numbering. */
export function writerSlots(pattern: GenerationProfile['compositions'][number]) {
  const numbers = numberedSlots(pattern);
  return writableSlots(pattern).filter((slot) => !numbers.has(slot.slotId));
}

/**
 * What the planner sees of a composition. Fonts, boxes and line metrics are the engine's
 * business; the planner needs the structure: how many slots it must fill and what each one held.
 */
export function plannerComposition(
  pattern: GenerationProfile['compositions'][number],
  note?: CompositionNote,
) {
  const slots = writerSlots(pattern);
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    ...(note ? { kind: note.kind, items: note.items, useFor: note.useFor } : {}),
    ...(note?.special ? { special: true } : {}),
    imageCount: pattern.imageCount,
    contentSlots: slots.filter((slot) => slot.role !== 'title').length,
    slots: slotBriefs(slots).map((slot) => ({
      role: slot.role,
      sample: slot.sample.replace(/\s+/g, ' ').trim().slice(0, 60),
      ...(slot.prompt ? { prompt: true } : {}),
      fitChars: slot.fitChars,
      row: slot.row,
      column: slot.column,
    })),
  };
}

/**
 * Template decks often repeat a sample slide: the same layout, the same slots, the same copy.
 * The planner reads one of each, so its catalog is shorter and it does not mistake a copy for
 * variety.
 */
export function distinctCompositions<T extends GenerationProfile['compositions'][number]>(
  catalog: readonly T[],
): T[] {
  const seen = new Set<string>();
  return catalog.filter((pattern) => {
    const key = JSON.stringify([
      pattern.name,
      pattern.imageCount,
      pattern.slots.map((slot) => [slot.role, slot.sample.trim(), slot.maxChars, slot.maxLines]),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
        writerSlots(pattern).map((slot) => [
          slot.slotId,
          // Permissive on purpose: an empty or too long slot is sent to the rewriter after
          // parsing, instead of failing the whole request at the provider.
          z.string(),
        ]),
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
    slots: slotBriefs(writerSlots(pattern)),
  };
}

/** Empty visible slots: the card, pill or frame around them stays on the slide with no copy. */
export function emptySlots(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): string[] {
  return writableSlots(pattern)
    .filter((slot) => slot.slotId !== slide.visual?.slotId)
    .filter((slot) => !(slide.texts.find((t) => t.slotId === slot.slotId)?.text ?? '').trim())
    .map((slot) => slot.slotId);
}

const EMPTY_SLOT_MESSAGE =
  'This slot is empty, but its card or frame stays visible on the slide. Write a distinct point ' +
  'that supports the slide purpose and does not repeat any other slot. Follow the sample: a short ' +
  'label stays a short label, a numbering sample like 01 continues the numbering.';

/** Title and fit problems block a slide; an empty body slot is repaired but does not block. */
/**
 * Defects code can see in written copy that fit its box: the same phrase in two slots of one
 * slide, and a word longer than one line of its box, which the renderer breaks mid-word. Both are
 * sent to the rewriter; neither blocks the deck if the rewrite does not cure it.
 */
export function copyDefects(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): Map<string, string> {
  const defects = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const slot of writerSlots(pattern)) {
    if (slot.slotId === slide.visual?.slotId) continue;
    const text = slide.texts.find((t) => t.slotId === slot.slotId)?.text.trim() ?? '';
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    const first = seen.get(key);
    if (first) {
      defects.set(
        slot.slotId,
        `Slot ${first} already says "${text}". Write a different point for this slot.`,
      );
      continue;
    }
    seen.set(key, slot.slotId);
    const perLine = Math.floor(slot.maxChars / Math.max(1, slot.maxLines));
    const long = text.split(/\s+/).find((word) => word.length > perLine);
    if (perLine >= 6 && long)
      defects.set(
        slot.slotId,
        `The word "${long}" is longer than one line of this box (${perLine} characters) and ` +
          'breaks mid-word. Rephrase with shorter words.',
      );
  }
  return defects;
}

function blockingProblems(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): string[] {
  return validateBindings(slide, pattern).filter(
    (problem) => !problem.startsWith('Fill empty slot') && !problem.startsWith('Revise slot'),
  );
}

function slotCorrections(slide: ComposedSlide, pattern: GenerationProfile['compositions'][number]) {
  const empty = new Set(emptySlots(slide, pattern));
  const defects = copyDefects(slide, pattern);
  return writableSlots(pattern)
    .filter((slot) => {
      const text = slide.texts.find((t) => t.slotId === slot.slotId)?.text ?? '';
      return (
        empty.has(slot.slotId) ||
        defects.has(slot.slotId) ||
        text.length > fitChars(slot) ||
        text.length > slot.maxChars ||
        text.split('\n').length > slot.maxLines
      );
    })
    .map((slot) => ({
      slotId: slot.slotId,
      message: empty.has(slot.slotId)
        ? EMPTY_SLOT_MESSAGE
        : (defects.get(slot.slotId) ??
          `Maximum ${fitChars(slot)} characters and ${slot.maxLines} lines. The template sample was ${slot.sample.length} characters.`),
    }));
}

export function createGenerationWorkflow(deps: GenerationDependencies) {
  let completed = 0;
  const plan = createStep({
    id: 'plan-compositions',
    inputSchema,
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
      const notes = new Map((deps.notes ?? []).map((note) => [note.patternId, note]));
      // Pages about the template itself are not slides. Keep them only if the indexer left
      // too little to build a deck from, which means it misread the template.
      const all = distinctCompositions(inputData.profile.compositions);
      const usable = all.filter((pattern) => !notes.get(pattern.patternId)?.skip);
      const distinct = usable.length >= 3 ? usable : all;
      // A title on a pill holds a short claim, not a sentence, so the floor is a few words.
      // Numbering is written by code and does not need room for a phrase.
      const spacious = distinct.filter(
        (p) =>
          p.slots.some((s) => s.role === 'title' && s.maxChars >= SHORT_CLAIM_CHARS) &&
          writerSlots(p).every((s) => s.maxChars >= 12),
      );
      // A deck opens and ends on the template's own cover and closing, and those carry short
      // lines (a date, a tag, the speaker) the floor above would drop them for.
      const framing = distinct.filter((p) => {
        const note = notes.get(p.patternId);
        return note && !note.special && (note.kind === 'cover' || note.kind === 'closing');
      });
      const full = spacious.length
        ? distinct.filter((p) => spacious.includes(p) || framing.includes(p))
        : distinct;
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
      const indexedCovers = full.filter((p) => notes.get(p.patternId)?.kind === 'cover');
      // A special cover (a partner's co-branding) opens a deck only when nothing else can.
      const plainCovers = indexedCovers.filter((p) => !notes.get(p.patternId)?.special);
      const covers = plainCovers.length
        ? plainCovers
        : indexedCovers.length
          ? indexedCovers
          : coversOf(full);
      const catalog = variantCatalog(full, variant, covers);
      // The story is planned once for all three variants, on the full catalog; each variant then
      // lays the same slides out on its own compositions (remapPlan).
      const outline = inputData.outline ?? null;
      const slideCount = outline?.slides.length ?? inputData.slideCount;
      const computePlan = async () => {
        const plan = (
          corrections?: Record<string, unknown>,
          previous?: z.infer<typeof compositionPlanSchema>,
        ) =>
          deps.provider.generate(
            'planner',
            deps.plannerInstructions,
            {
              brief: inputData.brief,
              slideCount,
              ...(outline ? { outline } : {}),
              catalog: full.map((pattern) =>
                plannerComposition(pattern, notes.get(pattern.patternId)),
              ),
              coverPatternIds: covers.map((p) => p.patternId),
              ...(previous ? { previous } : {}),
              ...(corrections ? { corrections } : {}),
            },
            compositionPlanSchema,
            deps.signal,
          );
        const countCorrections = (result: z.infer<typeof compositionPlanSchema>) =>
          slideCount === null || result.slides.length === slideCount
            ? undefined
            : {
                exactSlideCount: slideCount,
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
            exactSlideCount: slideCount,
            message: 'Return 10 to 60 slides in auto mode, or exactly the requested count.',
          });
        }
        // One layout repeated over most of the deck reads as the same slide again and again; the
        // planner gets the overused ids and replans once.
        const varietyCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          const limit = patternUseLimit(full.length, result.slides.length);
          const overused = overusedPatterns(
            result.slides.map((slide) => slide.patternId),
            limit,
          );
          return overused.length && full.length > 1
            ? {
                overusedPatternIds: overused,
                maximumUsesPerPattern: limit,
                message:
                  'Use each composition at most maximumUsesPerPattern times and never on three ' +
                  'slides in a row; vary the layouts.',
              }
            : undefined;
        };
        const corrections = {
          ...countCorrections(result),
          ...coverCorrections(result),
          ...varietyCorrections(result),
        };
        if (Object.keys(corrections).length) result = await plan(corrections, result);
        if (slideCount !== null && result.slides.length !== slideCount)
          throw new Error('Planner returned the wrong slide count.');
        if (coverCorrections(result))
          throw new Error('Planner did not select a cover composition.');
        return outline ? keepOutline(result, outline) : result;
      };
      const result = deps.sharedPlan
        ? await deps.sharedPlan.once(computePlan)
        : await computePlan();
      const layouts = remapPlan(
        result.slides.map((slide) => slide.patternId),
        full,
        catalog,
        variant,
        covers,
        notes,
      );
      return result.slides.map((slide, index) => {
        const composition = inputData.profile.compositions.find(
          (p) => p.patternId === layouts[index],
        );
        if (!composition) throw new Error('Planner selected an unknown template composition.');
        return {
          ...slide,
          patternId: composition.patternId,
          narrative: result.slides.map((s) => s.purpose),
          index,
          total: result.slides.length,
          audience: result.audience,
          goal: result.goal,
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
      const texts = raw.textsBySlot as Record<string, string | undefined>;
      const numbers = numberedSlots(inputData.composition);
      slide = {
        patternId: raw.patternId,
        speakerNotes: raw.speakerNotes,
        // Numbering comes from code; mirrors and the slot a visual replaces carry no text.
        texts: inputData.composition.slots.map((slot) => ({
          slotId: slot.slotId,
          text:
            visual?.slotId === slot.slotId
              ? ''
              : (numbers.get(slot.slotId) ?? (texts[slot.slotId] ?? '').trim()),
        })),
        visual,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!validateBindings(slide, inputData.composition).length) break;
        const current: ComposedSlide = slide;
        slide = await rewriteSlide(deps, {
          index: inputData.index,
          brief: inputData.brief,
          purpose: inputData.purpose,
          composition: inputData.composition,
          previous: current,
          corrections: slotCorrections(current, inputData.composition),
        });
        // A rewrite that changed nothing means the model cannot cure the slide: stop drawing and
        // keep the copy, so the variant still completes and the audit reports what is left.
        if (slide.texts.every((t, index) => t.text === current.texts[index]?.text)) break;
      }
      if (!slide) throw new Error(`Slide ${inputData.index + 1} was never written.`);
      // The rewriter could not cure every blocking defect, but the deck must still be produced:
      // three variants are mandatory, so a stubborn slide becomes a warning, not a failed run.
      for (const problem of blockingProblems(slide, inputData.composition))
        await deps.onWarning?.(`Slide ${inputData.index + 1}: ${problem}`);
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
 * The plan of an approved outline says what the outline says. The deck is titled as the outline,
 * speaks to its audience, and every slide keeps its claim: the planner chose the compositions, but
 * a slide whose purpose lost the approved title gets the outline's own words back.
 */
export function keepOutline(
  plan: z.infer<typeof compositionPlanSchema>,
  outline: DeckOutline,
): z.infer<typeof compositionPlanSchema> {
  return {
    ...plan,
    title: outline.title,
    audience: outline.audience || plan.audience,
    goal: outline.goal || plan.goal,
    slides: plan.slides.map((slide, index) => {
      const planned = outline.slides[index];
      if (!planned || slide.purpose.includes(planned.title)) return slide;
      const points = planned.points.join('; ');
      return {
        ...slide,
        purpose: (points ? `${planned.title} — ${points}` : planned.title).slice(0, 600),
      };
    }),
  };
}

/**
 * One plan for the variants of a brief, computed by whichever variant gets there first and awaited
 * by the others, so the three decks tell the same story and the planner is called once.
 */
export class SharedPlan {
  private pending: Promise<z.infer<typeof compositionPlanSchema>> | undefined;

  once(
    compute: () => Promise<z.infer<typeof compositionPlanSchema>>,
  ): Promise<z.infer<typeof compositionPlanSchema>> {
    this.pending ??= compute();
    return this.pending;
  }
}

/**
 * The composition each planned slide gets in a variant. Balanced keeps the planner's. Dense and
 * airy take, from their own catalog, a composition with as many text blocks as the planned one,
 * the roomiest for dense and the lightest for airy, spreading slides over the three best so no
 * layout repeats through the deck. The cover stays the planner's in every variant.
 */
export function remapPlan<T extends GenerationProfile['compositions'][number]>(
  patternIds: readonly string[],
  full: readonly T[],
  catalog: readonly T[],
  variant: DeckVariant,
  covers: readonly T[] = [],
  notes: ReadonlyMap<string, CompositionNote> = new Map(),
): string[] {
  if (variant === 'balanced') return [...patternIds];
  // Blocks as the planner counted them: numbering and mirrored copies are not points.
  const content = (p: T) => writerSlots(p).filter((s) => s.role !== 'title');
  const capacity = (p: T) => content(p).reduce((sum, s) => sum + s.maxChars, 0);
  const blocks = (p: T) => content(p).length;
  const coverIds = new Set(covers.map((p) => p.patternId));
  const special = (id: string) => notes.get(id)?.special === true;
  // A layout for code or a device screen is never a stand-in for an ordinary slide, and the
  // planner chose a special one for its content, so that one stays in every variant.
  const pool = catalog.filter((p) => !coverIds.has(p.patternId) && !special(p.patternId));
  const used = new Map<string, number>();
  return patternIds.map((id, index) => {
    const planned = full.find((p) => p.patternId === id);
    if (
      planned === undefined ||
      index === 0 ||
      coverIds.has(id) ||
      special(id) ||
      pool.length === 0
    )
      return id;
    const sameCount = pool.filter((p) => blocks(p) === blocks(planned));
    // The indexer's kind keeps a process a process and cards cards when the template has both.
    const kind = notes.get(planned.patternId)?.kind;
    const sameKind = sameCount.filter((p) => kind && notes.get(p.patternId)?.kind === kind);
    const same = sameKind.length ? sameKind : sameCount;
    const ranked = [...(same.length ? same : pool)].sort((a, b) =>
      variant === 'dense' ? capacity(b) - capacity(a) : capacity(a) - capacity(b),
    );
    const choice = ranked
      .slice(0, 3)
      .reduce((best, p) =>
        (used.get(p.patternId) ?? 0) < (used.get(best.patternId) ?? 0) ? p : best,
      );
    used.set(choice.patternId, (used.get(choice.patternId) ?? 0) + 1);
    return choice.patternId;
  });
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
  const mirrored = mirroredSlots(pattern);
  const empty = new Set(emptySlots(slide, pattern));
  const defects = copyDefects(slide, pattern);
  for (const slot of pattern.slots) {
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    if (!binding) errors.push(`Missing slot ${slot.slotId}`);
    else if (mirrored.has(slot.slotId)) {
      if (binding.text.trim()) errors.push(`Clear mirrored slot ${slot.slotId}`);
    } else if (slot.role === 'title' && !binding.text.trim())
      errors.push(`Title ${slot.slotId} must not be empty`);
    else if (empty.has(slot.slotId)) errors.push(`Fill empty slot ${slot.slotId}`);
    else if (
      binding.text.length > fitChars(slot) ||
      binding.text.length > slot.maxChars ||
      binding.text.split('\n').length > slot.maxLines
    )
      errors.push(
        `Shorten slot ${slot.slotId} to <= ${fitChars(slot)} chars and ${slot.maxLines} lines`,
      );
    else if (defects.has(slot.slotId)) errors.push(`Revise slot ${slot.slotId}`);
  }
  return errors;
}

export const repairTaskSchema = z.object({
  index: z.number(),
  brief: z.string(),
  /** The slide's claim from the plan: an empty card is filled with a point that supports it. */
  purpose: z.string().optional(),
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
      // Same guarantee as the write step: an uncured slide is reported through onWarning, not
      // fatal, so the run keeps all three variants.
      for (const problem of blockingProblems(slide, inputData.composition))
        await deps.onWarning?.(`Repair slide ${inputData.index + 1}: ${problem}`);
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

/** The longest alternative that still fits the slot, or undefined when none of them do. */
function bestFittingAlternative(
  slot: { role: string; sample: string; maxChars: number; maxLines: number; prompt?: boolean },
  alternatives: readonly string[],
): string | undefined {
  return alternatives
    .filter(
      (t) =>
        t.length <= fitChars(slot) &&
        t.length <= slot.maxChars &&
        t.split('\n').length <= slot.maxLines &&
        (slot.role !== 'title' || t.trim()),
    )
    .sort((a, b) => b.length - a.length)[0];
}

/** How many times the rewriter may be asked to fix one slide before the deck fails. */
const MAX_REWRITE_ATTEMPTS = 5;

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
      Object.fromEntries(
        slots.map((s) => [
          s.slotId,
          z.array(s.role === 'title' ? z.string().min(1) : z.string()).length(3),
        ]),
      ),
    ),
  });
  const input = (feedback?: string) => ({
    brief: task.brief,
    ...(task.purpose ? { purpose: task.purpose } : {}),
    // The filled slots of the same slide, so a new point does not repeat them.
    otherSlots: task.previous.texts
      .filter((t) => t.text.trim() && !slots.some((s) => s.slotId === t.slotId))
      .map((t) => t.text),
    ...(feedback ? { feedback } : {}),
    slots: slots.map((s) => ({
      slotId: s.slotId,
      role: s.role,
      sample: s.sample,
      ...(s.prompt ? { prompt: true } : {}),
      maxChars: s.maxChars,
      fitChars: fitChars(s),
      maxLines: s.maxLines,
      text: task.previous.texts.find((t) => t.slotId === s.slotId)?.text,
      correction: task.corrections
        .filter((c) => c.slotId === s.slotId)
        .map((c) => c.message)
        .join('; '),
    })),
  });
  const mustFit = (slot: (typeof slots)[number]) => {
    const before = task.previous.texts.find((t) => t.slotId === slot.slotId)?.text ?? '';
    return before.trim() !== '' || slot.role === 'title';
  };
  let result: z.infer<typeof schema> | undefined;
  let feedback: string | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt++) {
    deps.signal.throwIfAborted();
    try {
      result = await deps.provider.generate(
        'rewriter',
        deps.repairInstructions ?? deps.writerInstructions,
        input(feedback),
        schema,
        deps.signal,
      );
    } catch (error) {
      // A broken answer is one more draw, not the end of the deck: keep the last error and retry.
      if (attempt + 1 >= MAX_REWRITE_ATTEMPTS) throw error;
      lastError = error;
      continue;
    }
    const rewrites = result.rewrites;
    // The model may still return alternatives longer than fitChars despite the prompt: tell it
    // exactly which slots overflowed and by how much, then ask again.
    const tooLong = slots.filter(
      (slot) =>
        mustFit(slot) && bestFittingAlternative(slot, rewrites[slot.slotId] ?? []) === undefined,
    );
    if (tooLong.length === 0) break;
    feedback = tooLong
      .map((slot) => {
        const lengths = (rewrites[slot.slotId] ?? []).map((t) => t.length).join(', ');
        return (
          `Слот ${slot.slotId} (${slot.role}): все три варианта длиннее лимита ` +
          `${fitChars(slot)} символов (получено: ${lengths}). Каждую альтернативу напиши ` +
          `не длиннее ${fitChars(slot)} символов с пробелами.`
        );
      })
      .join('\n');
  }
  if (!result) {
    // The rewriter could not answer at all (every draw failed): keep the previous copy. A broken
    // model session must not drop the variant — all three presentations are mandatory, and the
    // audit reports what remains.
    await deps.onWarning?.(
      `Рерайтер не ответил для слайда ${task.index + 1}: ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
    return task.previous;
  }
  const slide = { ...task.previous, texts: task.previous.texts.map((t) => ({ ...t })) };
  for (const slot of slots) {
    const alternatives = result.rewrites[slot.slotId] ?? [];
    const text = bestFittingAlternative(slot, alternatives);
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    // No alternative fits the box. The slot keeps its previous copy (or stays empty when it was
    // an unfillable card): a flagged slide costs one finding, a failed variant would cost the
    // whole deck, and all three variants are mandatory.
    if (text === undefined) continue;
    if (binding) binding.text = text;
  }
  return slide;
}
