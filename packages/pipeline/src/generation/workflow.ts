import {
  composedSlideSchema,
  compositionPlanSchema,
  compositionSchema,
  deckOutlineSchema,
  generationProfileSchema,
  slotChartSchema,
  slotRewriteChoicesSchema,
  slotTableSchema,
  slotNativeSchema,
  requiredSlideClaimSchema,
  templateSlotCopySchema,
  templateDeckCopySchema,
  templateDeckRepairsSchema,
  type Dataset,
  type ComposedSlide,
  type CompositionNote,
  type DeckOutline,
  type GenerationProfile,
  type SlotVisual,
  type VariantCopyMode,
} from '@lct/contracts';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { tearsAWord } from './fit.js';
import { isFigureSample } from './samples.js';
import { diversifyPlan } from './variety.js';
import type { TextProvider } from './provider.js';
import { declaredQrSlots, safeQrPlan, sourceQrUrls } from './qr-assets.js';
import { dependencyKey } from './checkpoints.js';
import { compositionSemantics, semanticSlotMap } from './semantics.js';
import { type WriterModules, writerPrompt } from './writer-prompt.js';
import type { AttemptBudget } from './attempt-budget.js';
import { retainsClaimDetails } from './claim-details.js';
import { boundedDatasetEvidence } from './dataset-evidence.js';
import { figuresOf } from './repeats.js';
import { plannedSeriesChart, quotesSeries, seriesFacts, verifyVisual } from './visual-grounding.js';
import { sourceBriefTexts } from './source-brief.js';
import { ampleComposition } from './composition-feasibility.js';
import { selectSlideRepair } from './repair-selection.js';
export { prepareDatasets } from './dataset-evidence.js';
export { compositionPlanSchema, compositionCritiqueSchema as critiqueSchema } from '@lct/contracts';

/** The three renderings of one brief. They differ in composition and density, not in facts. */
export type DeckVariant = 'dense' | 'balanced' | 'airy';

/**
 * How a variant remaps a shared plan onto its catalog. `density` is the production choice:
 * the same block count, or one more or fewer when that is all the catalog has. The strict
 * policy never changes the number of content blocks.
 */
export type LayoutRemapPolicy = 'density' | 'preserve-block-count' | 'conceptual';

export interface GenerationDependencies {
  provider: TextProvider;
  /** Trusted deterministic extraction prepared by the API, never a model answer. */
  preparedDatasets?: readonly Dataset[];
  /** Which rendering to lay out and write. Absent: balanced. */
  variant?: DeckVariant;
  /**
   * How a variant picks a layout for a shared plan. Absent and `density` keep the existing
   * choice, including a layout one block away. `preserve-block-count` keeps the planned layout
   * unless the variant has one with the same number of content blocks.
   */
  layoutRemapPolicy?: LayoutRemapPolicy;
  /** The one plan the variants of a brief share. Absent: this run plans for itself. */
  sharedPlan?: SharedPlan;
  /** Reuses accepted canonical copy when the caller explicitly selects shared mode. */
  sharedContent?: SharedContent;
  variantCopyMode?: VariantCopyMode;
  writerModules?: WriterModules;
  attemptBudget?: AttemptBudget;
  plannerInstructions: string;
  writerInstructions: string;
  /** With this registry instruction one writer owns the entire variant. */
  deckWriterInstructions?: string;
  /** One targeted repair call for all affected slides of a variant. */
  deckRepairInstructions?: string;
  repairInstructions?: string;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
  /** Leftover defects a repair could not cure; reported, never fatal, so every variant finishes. */
  onWarning?: (message: string) => void | Promise<void>;
  /** What the template indexer read about each composition; absent when never indexed. */
  notes?: readonly CompositionNote[];
  /** The day the deck is dated by. Absent: today. */
  today?: Date;
  /**
   * Whether pictures can be drawn for image slots. Without them the planner is not offered a
   * composition with a place for a picture, so no slide is left with an empty frame.
   */
  imagesAvailable?: boolean;
  /** A model's draft is a story to lay out, never independent evidence of its facts. */
  outlineIsSource?: boolean;
  /** The laid-out slides, as soon as the plan is made: pictures are drawn while copy is written. */
  onPlan?: (slides: readonly PlannedSlide[]) => void;
  /** All tasks, including special QR compositions, after deterministic QR validation. */
  onQrPlan?: (slides: readonly PlannedSlide[]) => void | Promise<void>;
  /** Original source only; a model outline never authorizes a QR URL. */
  qrSourceBrief?: string;
}

/** A planned slide with its composition, as the illustrator needs it. */
export interface PlannedSlide {
  index: number;
  purpose: string;
  imageQuery: string;
  title: string;
  audience: string;
  goal: string;
  composition: GenerationProfile['compositions'][number];
  qrRequests?: z.infer<typeof compositionPlanSchema>['slides'][number]['qrRequests'];
}
const inputSchema = z.object({
  brief: z.string(),
  slideCount: z.number().int().min(5).max(15).nullable(),
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
  /** The approved title of this slide, when the person approved an outline. */
  slideTitle: z.string().optional(),
  approvedSlide: deckOutlineSchema.shape.slides.element.optional(),
  brief: z.string(),
  purpose: z.string(),
  imageQuery: z.string(),
  composition: compositionSchema,
  canonicalComposition: compositionSchema.optional(),
  requiredClaims: z.array(requiredSlideClaimSchema).default([]),
});
export const writtenSchema = z.object({
  index: z.number(),
  title: z.string(),
  /** The claim the plan gave the slide: the deck-wide checks and the repair read it. */
  purpose: z.string().default(''),
  approvedSlide: deckOutlineSchema.shape.slides.element.optional(),
  requiredClaims: z.array(requiredSlideClaimSchema).default([]),
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
 * a short assertion. A one-line label may take a third of its line: a one-word sample in a wide
 * box («Работа» over a step) must still hold the step's name in two words, and a third of a line
 * is still short of any pill drawn around the sample.
 */
export function fitChars(slot: {
  role: string;
  sample: string;
  maxChars: number;
  maxLines?: number;
  prompt?: boolean;
  capacity?: Slot['capacity'];
}): number {
  if (slot.capacity && slot.capacity.basis !== 'sample-fallback')
    return Math.min(slot.maxChars, slot.capacity.safeChars);
  const sampleLen = slot.sample.trim().length;
  // A layout prompt names the box but was never sized to it: the box itself is the measure.
  if (sampleLen === 0 || slot.prompt)
    return Math.min(slot.maxChars, slot.capacity?.safeChars ?? slot.maxChars);
  const scaled = Math.ceil(sampleLen * 1.25);
  const label = slot.maxLines === 1 ? Math.floor(slot.maxChars / 3) : 0;
  const floor = Math.min(slot.maxChars, slot.role === 'title' ? 36 : Math.max(8, label));
  return Math.min(
    slot.capacity?.safeChars ?? slot.maxChars,
    Math.max(4, Math.min(slot.maxChars, Math.max(scaled, floor))),
  );
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

/** Required context is accepted only when the planner cites an exact source excerpt. */
export function missingRequiredContent(
  plan: z.infer<typeof compositionPlanSchema>,
  notes: ReadonlyMap<string, CompositionNote>,
  source: string,
) {
  return plan.slides.flatMap((slide, slideIndex) => {
    const requirements = (notes.get(slide.patternId)?.requiredContent ?? []).filter((item) => {
      if (item === 'image') return false;
      const quote = slide.sourceEvidence[item]?.trim();
      return (
        !quote ||
        !source.includes(quote) ||
        (item === 'person-name' && quote.split(/\s+/).length < 2) ||
        (item === 'quantitative-data' && !/\d/.test(quote))
      );
    });
    return requirements.length ? [{ slideIndex, patternId: slide.patternId, requirements }] : [];
  });
}

/**
 * The plan with every slide whose composition asks for material the source lacks moved to the
 * closest composition that asks for nothing missing: the same family (framing or content), the
 * nearest number of blocks, the least used. A slide with no such composition keeps its own; its
 * fields for missing facts stay empty. A deck is never lost to one layout the planner insisted on.
 */
export function withoutMissingContent<T extends GenerationProfile['compositions'][number]>(
  plan: z.infer<typeof compositionPlanSchema>,
  missing: readonly { slideIndex: number }[],
  catalog: readonly T[],
  notes: ReadonlyMap<string, CompositionNote>,
  imagesAvailable: boolean,
): z.infer<typeof compositionPlanSchema> {
  if (!missing.length) return plan;
  const framing = (id: string) => FRAMING_KINDS.has(notes.get(id)?.kind ?? 'other');
  const blocks = (p: T) => writerSlots(p).filter((s) => s.role !== 'title').length;
  const free = catalog.filter(
    (p) =>
      !notes.get(p.patternId)?.skip &&
      (notes.get(p.patternId)?.requiredContent ?? []).every(
        (item) => item === 'image' && imagesAvailable,
      ),
  );
  const used = new Map<string, number>();
  for (const slide of plan.slides) used.set(slide.patternId, (used.get(slide.patternId) ?? 0) + 1);
  const moved = new Set(missing.map((item) => item.slideIndex));
  return {
    ...plan,
    slides: plan.slides.map((slide, index) => {
      const planned = catalog.find((p) => p.patternId === slide.patternId);
      if (!moved.has(index) || !planned) return slide;
      const kind = notes.get(slide.patternId)?.kind;
      const choice = free
        .filter((p) => framing(p.patternId) === framing(slide.patternId))
        .filter((p) => index > 0 || notes.get(p.patternId)?.kind === 'cover' || kind !== 'cover')
        .sort(
          (a, b) =>
            Math.abs(blocks(a) - blocks(planned)) - Math.abs(blocks(b) - blocks(planned)) ||
            Number(notes.get(b.patternId)?.kind === kind) -
              Number(notes.get(a.patternId)?.kind === kind) ||
            (used.get(a.patternId) ?? 0) - (used.get(b.patternId) ?? 0),
        )[0];
      if (!choice) return slide;
      used.set(choice.patternId, (used.get(choice.patternId) ?? 0) + 1);
      return { ...slide, patternId: choice.patternId, sourceEvidence: {} };
    }),
  };
}

/** Reading order of a composition's slots. Row and column are indexes, not coordinates. */
/** Share of a text block's room each variant fills at least: a nearly empty card is a defect. */
const FILL_FLOOR: Record<DeckVariant, number> = { dense: 0.5, balanced: 0.4, airy: 0.25 };

/**
 * The fewest characters a text block carries for its box not to read as empty. Only a block the
 * template filled with several lines, or a prompt box of four lines or more, has a floor: labels,
 * headings and one-line fields are short by design.
 */
export function minChars(
  slot: {
    role: string;
    sample: string;
    maxChars: number;
    maxLines: number;
    prompt?: boolean;
    capacity?: Slot['capacity'];
    semanticRole?: string;
  },
  variant: DeckVariant = 'balanced',
): number {
  if (slot.role !== 'body') return 0;
  if (slot.semanticRole && ['slide-title', 'card-heading', 'caption'].includes(slot.semanticRole))
    return 0;
  // A paragraph break and a line break inside one (a vertical tab in the pptx) both start a line.
  const sampleLines = slot.sample.split(/[\n\v]/).filter((line) => line.trim()).length;
  const block =
    slot.capacity && slot.capacity.basis !== 'sample-fallback'
      ? slot.maxLines >= 3 && fitChars(slot) >= 80
      : slot.prompt
        ? slot.maxLines >= 4
        : sampleLines >= 2 && slot.maxLines >= 3;
  return block ? Math.floor(fitChars(slot) * FILL_FLOOR[variant]) : 0;
}

/** What the writer and the rewriter are told when a block is too thin for its box. */
export function thinMessage(length: number, least: number, room: number): string {
  return (
    `The text has ${length} characters in a box made for about ${room}: the slide looks empty. ` +
    `Advisory target: ${least} to ${room} characters; available evidence may limit detail.`
  );
}

export function slotBriefs(
  slots: GenerationProfile['compositions'][number]['slots'],
  variant?: DeckVariant,
  semantics: readonly { slotId: string; semanticRole: string; groupId?: string }[] = [],
) {
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
    const policySlot = { ...slot, ...semantics.find((entry) => entry.slotId === slot.slotId) };
    return {
      slotId: slot.slotId,
      role: slot.role,
      sample: slot.sample,
      ...(slot.prompt ? { prompt: true } : {}),
      maxChars: slot.maxChars,
      maxLines: slot.maxLines,
      fontSize: slot.fontSize,
      fitChars: fitChars(slot),
      ...targetRange(policySlot, variant ?? 'balanced'),
      ...(slot.capacity ? { capacity: slot.capacity } : {}),
      ...(slot.textWidthPt ? { textWidthPt: slot.textWidthPt } : {}),
      ...(slot.textHeightPt ? { textHeightPt: slot.textHeightPt } : {}),
      ...(slot.lineSpacing ? { lineSpacing: slot.lineSpacing } : {}),
      ...(slot.spaceBeforePt !== undefined ? { spaceBeforePt: slot.spaceBeforePt } : {}),
      ...(slot.spaceAfterPt !== undefined ? { spaceAfterPt: slot.spaceAfterPt } : {}),
      ...(variant && minChars(policySlot, variant)
        ? { minChars: minChars(policySlot, variant) }
        : {}),
      row,
      column,
    };
  });
}

/** Calibratable density goals; safe capacity is always the hard upper bound. */
export function targetRange(slot: Parameters<typeof minChars>[0], variant: DeckVariant) {
  const room = fitChars(slot);
  const large =
    slot.role === 'body' &&
    slot.maxLines >= 3 &&
    room >= 80 &&
    !['slide-title', 'card-heading', 'caption'].includes(slot.semanticRole ?? 'unknown');
  const shares = { airy: [0.25, 0.45], balanced: [0.4, 0.7], dense: [0.65, 0.95] } as const;
  const [lo, hi] = shares[variant];
  return {
    targetMinChars: large ? Math.floor(room * lo) : 0,
    targetMaxChars: large ? Math.floor(room * hi) : room,
  };
}

/** Lines of copy a box must hold before code puts a planned chart there. */
const CHART_MIN_LINES = 8;

/** The body slot tall enough for a chart; a two-line statement box would squash the bars flat. */
export function chartSlot(pattern: GenerationProfile['compositions'][number]): string | undefined {
  return visualSlots(pattern).find(
    (id) => (pattern.slots.find((slot) => slot.slotId === id)?.maxLines ?? 0) >= CHART_MIN_LINES,
  );
}

/** Points of a purpose that state a figure: «80% успешных; облачность при неудачах 43,33; …». */
function figurePoints(purpose: string): number {
  // The points follow the claim: after its dash, or after its colon when there is no dash.
  const dash = purpose.indexOf(' — ');
  const colon = purpose.indexOf(': ');
  const at = dash >= 0 ? dash + 3 : colon >= 0 ? colon + 2 : -1;
  if (at < 0) return 0;
  return purpose
    .slice(at)
    .split(/;\s*/u)
    .filter((point) => /\d/u.test(point)).length;
}

/**
 * The layout a data slide needs, whatever the planner picked: a slide of three or more figures
 * that quotes no series line goes to the composition whose slots are figures, a slide that quotes
 * a ready series to a composition with room for its chart. The cover and the closing slide stay as planned.
 */
export function withDataLayouts<T extends { patternId: string; purpose: string }>(
  slides: readonly T[],
  catalog: readonly GenerationProfile['compositions'][number][],
  brief: string,
): T[] {
  const charts = catalog.filter((pattern) => chartSlot(pattern) !== undefined);
  const figures = catalog.filter(
    (pattern) => writerSlots(pattern).filter((slot) => isFigureSample(slot.sample)).length >= 3,
  );
  return slides.map((slide, index) => {
    if (index === 0 || index === slides.length - 1) return slide;
    const current = catalog.find((pattern) => pattern.patternId === slide.patternId);
    const kpi = figures[0];
    if (
      kpi &&
      !figures.some((pattern) => pattern.patternId === slide.patternId) &&
      figurePoints(slide.purpose) >= 3 &&
      !quotesSeries(slide.purpose, brief)
    )
      return { ...slide, patternId: kpi.patternId };
    const chart = charts[0];
    if (
      chart &&
      !(current && chartSlot(current)) &&
      plannedSeriesChart(slide.purpose, brief, 'chart')
    )
      return { ...slide, patternId: chart.patternId };
    return slide;
  });
}

/** What a content slide must keep through every later layout pass. */
export type DataLayoutNeed = 'chart' | 'figures';

/**
 * The data layout a slide was given, read from its purpose. The cover and the closing slide
 * stay framing layouts. A slide of three figures that quotes no series needs figure slots; a
 * slide that quotes a ready series needs a chart slot. Later passes (variant remap, a second
 * spread, a roomier layout) may change the composition, but only for one that still has that.
 */
export function dataLayoutNeed(
  purpose: string,
  brief: string,
  index: number,
  total: number,
): DataLayoutNeed | undefined {
  if (total > 0 && (index === 0 || index === total - 1)) return undefined;
  if (figurePoints(purpose) >= 3 && !quotesSeries(purpose, brief)) return 'figures';
  if (plannedSeriesChart(purpose, brief, 'chart')) return 'chart';
  return undefined;
}

/** Whether a composition can still show what `withDataLayouts` asked this slide to show. */
export function fitsDataLayout(
  pattern: GenerationProfile['compositions'][number],
  need: DataLayoutNeed,
): boolean {
  if (need === 'chart') return chartSlot(pattern) !== undefined;
  return writerSlots(pattern).filter((slot) => isFigureSample(slot.sample)).length >= 3;
}

/**
 * The composition a data slide keeps. One that already fits stays, so a variant may use its
 * own chart or figure layout. One that no longer fits returns to a layout that does: the
 * roomiest for dense, the lightest for airy, the first in the catalog for balanced. A template
 * with no such layout keeps the composition it has.
 */
export function preserveDataLayout<T extends GenerationProfile['compositions'][number]>(
  selected: T,
  catalog: readonly T[],
  need: DataLayoutNeed | undefined,
  variant: DeckVariant,
): T {
  if (!need || fitsDataLayout(selected, need)) return selected;
  const fitting = catalog.filter((pattern) => fitsDataLayout(pattern, need));
  const first = fitting[0];
  if (!first) return selected;
  if (variant === 'balanced') return first;
  const capacity = (pattern: T) =>
    writerSlots(pattern)
      .filter((slot) => slot.role !== 'title')
      .reduce((sum, slot) => sum + slot.maxChars, 0);
  return (
    [...fitting].sort((a, b) =>
      variant === 'dense' ? capacity(b) - capacity(a) : capacity(a) - capacity(b),
    )[0] ?? first
  );
}

/**
 * A slide already on the layout its data needs may move only to another such layout. A slide
 * not yet on one stays free: `withDataLayouts` places it afterwards.
 */
function allowsDataMove<T extends GenerationProfile['compositions'][number]>(
  slides: readonly { patternId: string; purpose: string }[],
  brief: string,
  catalog: readonly T[],
  index: number,
  to: T,
): boolean {
  const slide = slides[index];
  if (!slide) return true;
  const need = dataLayoutNeed(slide.purpose, brief, index, slides.length);
  if (!need) return true;
  const current = catalog.find((pattern) => pattern.patternId === slide.patternId);
  return !current || !fitsDataLayout(current, need) || fitsDataLayout(to, need);
}

/** Data slides a deck with ready series is planned to show at least. */
const CHART_SLIDES = 2;

export function visualSlots(pattern: GenerationProfile['compositions'][number]): string[] {
  const mirrored = mirroredSlots(pattern);
  return pattern.slots
    .filter(
      (slot) =>
        slot.role === 'body' && slot.maxChars >= VISUAL_MIN_CHARS && !mirrored.has(slot.slotId),
    )
    .filter((slot) => {
      // Native data need room for labels and several rows, measured in this template's font.
      // Legacy profiles without geometry retain their capacity-based compatibility.
      if (!slot.box) return true;
      const em = slot.fontSize * 12700;
      return slot.box.cx >= em * 12 && slot.box.cy >= em * 7;
    })
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

type Slot = GenerationProfile['compositions'][number]['slots'][number];

/** Two slots drawn as one kind of shape: the same type size and nearly the same box. */
function sameShape(a: Slot, b: Slot): boolean {
  if (!a.box || !b.box || Math.abs(a.fontSize - b.fontSize) > 1) return false;
  const near = (x: number, y: number) => Math.abs(x - y) <= 0.1 * Math.max(x, y, 1);
  return near(a.box.cx, b.box.cx) && near(a.box.cy, b.box.cy);
}

/**
 * The composition with its title where a reader sees it. A slide of steps draws the same heading
 * over each step, and the first of them sits highest, so the template reads it as the title. A
 * title drawn exactly like a body slot is one heading of a row: it is written as its siblings are,
 * and the slot in the largest type becomes the title. The writer would otherwise give the first
 * step the slide's claim and squeeze the claim into a line meant for a short label.
 */
export function withCardHeadings<T extends GenerationProfile['compositions'][number]>(
  pattern: T,
  note?: CompositionNote,
): T {
  const semantics = compositionSemantics(pattern, note);
  if (semantics.slots.some((slot) => slot.semanticRole === 'slide-title')) {
    return {
      ...pattern,
      slots: pattern.slots.map((slot) => ({
        ...slot,
        role:
          semantics.slots.find((entry) => entry.slotId === slot.slotId)?.semanticRole ===
          'slide-title'
            ? ('title' as const)
            : ('body' as const),
      })),
    };
  }
  const title = pattern.slots.find((slot) => slot.role === 'title');
  if (!title || !pattern.slots.some((s) => s.role !== 'title' && sameShape(title, s)))
    return pattern;
  const largest = pattern.slots
    .filter((slot) => slot.role !== 'title' && !sameShape(title, slot))
    .sort((a, b) => b.fontSize - a.fontSize)[0];
  if (!largest || largest.fontSize <= title.fontSize) return pattern;
  return {
    ...pattern,
    slots: pattern.slots.map((slot) =>
      slot === title
        ? { ...slot, role: 'body' as const }
        : slot === largest
          ? { ...slot, role: 'title' as const }
          : slot,
    ),
  };
}

/** A profile whose compositions all read their card headings as headings. */
export function withCardHeadingProfile(
  profile: GenerationProfile,
  notes: readonly CompositionNote[] = [],
): GenerationProfile {
  return {
    ...profile,
    compositions: profile.compositions.map((pattern) =>
      withCardHeadings(
        pattern,
        notes.find((note) => note.patternId === pattern.patternId),
      ),
    ),
  };
}

const YEAR = /\b(?:19|20)\d{2}\b/g;
const MONTHS = {
  ru: [
    'январь',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ],
  en: [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ],
};
const MONTH_NAMES = [...MONTHS.ru, ...MONTHS.en];
/** A year, a numeric date in any order, or a month and a year: the whole of the sample. */
const DATE_SAMPLE = new RegExp(
  '^\\s*(?:(?:19|20)\\d{2}|\\d{1,2}[./-]\\d{1,2}[./-](?:19|20)\\d{2}|(?:19|20)\\d{2}-\\d{2}-\\d{2}|' +
    `(?:${MONTH_NAMES.join('|')})\\s+(?:19|20)\\d{2})\\s*(?:г\\.?|года?)?\\s*$`,
  'i',
);

/** What a date in the deck is judged against: the brief and the day it is made. */
export interface CopyContext {
  note?: CompositionNote;
  brief?: string;
  today?: Date;
  /** The rendering the copy is for: it sets how full a text block must be. */
  variant?: DeckVariant;
}

/** Years the brief names; a deck may speak of them. */
export function briefYears(brief: string): number[] {
  return [...new Set((brief.match(YEAR) ?? []).map(Number))].sort((a, b) => a - b);
}

/**
 * The year a deck is dated: the first year from this one on that the brief names (a plan for
 * next year is dated so), otherwise the current year. Never the year of the template's sample.
 */
export function deckYear(brief: string, today: Date): number {
  const current = today.getFullYear();
  return briefYears(brief).find((year) => year >= current) ?? current;
}

/**
 * Date slots and the dates code writes into them. A template's cover carries the year or the
 * date it was drawn, and a model asked to keep the form of the sample keeps its year too. A slot
 * whose whole sample is a date gets the deck's date in the sample's own format.
 */
export function datedSlots(
  pattern: GenerationProfile['compositions'][number],
  context: CopyContext = {},
) {
  const today = context.today ?? new Date();
  const year = deckYear(context.brief ?? '', today);
  const dates = new Map<string, string>();
  for (const slot of writableSlots(pattern)) {
    if (slot.role === 'title') continue;
    // A field labelled «Дата» on a cover holds the year the deck is shown.
    if (DATE_FIELDS.has(normalized(slot.sample))) dates.set(slot.slotId, String(year));
    else if (DATE_SAMPLE.test(slot.sample))
      dates.set(slot.slotId, formatLike(slot.sample.trim(), today, year));
  }
  return dates;
}

const DATE_FIELDS = new Set(['дата', 'date', 'год', 'year']);
/**
 * Names of fields a template marks for facts about the talk, not its subject: who speaks, how to
 * reach them, when. Words of the language, not of a template: any template labels such a field
 * so, and a writer with no fact for it writes the label back.
 */
const FIELD_LABELS = new Set([
  ...DATE_FIELDS,
  'спикер',
  'докладчик',
  'выступающий',
  'автор',
  'контакт',
  'контакты',
  'телефон',
  'почта',
  'email',
  'e mail',
  'имя',
  'фамилия',
  'имя фамилия',
  'фио',
  'должность',
  'speaker',
  'presenter',
  'author',
  'contact',
  'contacts',
  'phone',
  'name',
  'full name',
  'position',
]);

function formatLike(sample: string, today: Date, year: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  const numeric = /^(\d{1,2})([./-])(\d{1,2})\2((?:19|20)\d{2})(.*)$/.exec(sample);
  if (numeric) {
    const [, day = '', sep = '.', month = ''] = numeric;
    // A year the brief moved forward keeps no day of today: the date would be invented.
    if (year !== today.getFullYear()) return String(year);
    return `${pad(today.getDate(), day.length)}${sep}${pad(today.getMonth() + 1, month.length)}${sep}${year}${numeric[5] ?? ''}`;
  }
  const iso = /^((?:19|20)\d{2})-(\d{2})-(\d{2})$/.exec(sample);
  if (iso) {
    if (year !== today.getFullYear()) return String(year);
    return `${year}-${pad(today.getMonth() + 1, 2)}-${pad(today.getDate(), 2)}`;
  }
  const monthWord = MONTH_NAMES.find((name) => sample.toLowerCase().startsWith(name));
  if (monthWord) {
    const names = MONTHS.ru.includes(monthWord) ? MONTHS.ru : MONTHS.en;
    const name = names[today.getMonth()] ?? monthWord;
    const cased =
      sample[0] === sample[0]?.toUpperCase() ? name[0]?.toUpperCase() + name.slice(1) : name;
    if (year !== today.getFullYear()) return sample.replace(YEAR, String(year));
    return sample.replace(new RegExp(monthWord, 'i'), cased).replace(YEAR, String(year));
  }
  return sample.replace(YEAR, String(year));
}

/**
 * Years in written copy that are already past and that the brief does not name: the year of the
 * template's sample kept by the writer, or one it made up.
 */
export function staleYears(text: string, context: CopyContext = {}): number[] {
  const current = (context.today ?? new Date()).getFullYear();
  const named = new Set(briefYears(context.brief ?? ''));
  return [...new Set((text.match(YEAR) ?? []).map(Number))].filter(
    (year) => year < current && !named.has(year),
  );
}

const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * A label where content belongs: the slot says the template's own words, or names a field
 * («Контакт», «Спикер») instead of filling it, and the brief never says those words. Such a field
 * was left for facts the brief did not give.
 */
export function echoesSample(text: string, slot: Slot, brief = ''): boolean {
  const said = normalized(text);
  if (!said || NUMBERING.test(slot.sample)) return false;
  const label = said === normalized(slot.sample) || FIELD_LABELS.has(said.replace(/\s*\d+$/, ''));
  return label && !` ${normalized(brief)} `.includes(` ${said} `);
}

/** Word stems of a phrase, long enough to tell «Результат» from «Результаты» as one word. */
function stems(text: string): Set<string> {
  return new Set(
    normalized(text)
      .split(' ')
      .filter((word) => word.length >= 4)
      .map((word) => word.slice(0, 5)),
  );
}

/**
 * The heading of the card a slot sits in: a slot above it in the same column. A list that opens
 * with its own card's heading reads the heading twice.
 */
function headingAbove(slot: Slot, slots: readonly Slot[]): Slot[] {
  const box = slot.box;
  if (!box) return slots.filter((other) => other.slotId !== slot.slotId);
  return slots.filter((other) => {
    const above = other.box;
    if (!above || other.slotId === slot.slotId) return false;
    const overlap = Math.min(above.x + above.cx, box.x + box.cx) - Math.max(above.x, box.x);
    return above.y + above.cy <= box.y + box.cy * 0.1 && overlap > 0.5 * Math.min(above.cx, box.cx);
  });
}

/** Whether the first point of a list says what its heading already says. */
export function repeatsHeading(point: string, heading: string): boolean {
  const a = normalized(point);
  const b = normalized(heading);
  if (!a || !b) return false;
  if (a === b || ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)) return true;
  const sa = stems(point);
  return [...stems(heading)].some((stem) => sa.has(stem));
}

/** Slots whose copy the model writes: everything visible but mirrors, numbering and dates. */
export function writerSlots(pattern: GenerationProfile['compositions'][number]) {
  const numbers = numberedSlots(pattern);
  const dates = datedSlots(pattern);
  return writableSlots(pattern).filter(
    (slot) => !numbers.has(slot.slotId) && !dates.has(slot.slotId),
  );
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
  const semantics = compositionSemantics(pattern, note);
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    ...(note ? { kind: note.kind, items: note.items, useFor: note.useFor } : {}),
    ...(note?.special ? { special: true } : {}),
    ...(note ? { requiredContent: note.requiredContent } : {}),
    imageCount: pattern.imageCount,
    nativeVisualSlots: visualSlots(pattern),
    /** Places this composition has for a generated picture. */
    imageSlots: (pattern.imageSlots ?? []).filter(
      (s) => !declaredQrSlots(pattern, note).includes(s.slotId),
    ).length,
    ...(note?.qrSlotIds?.length ? { qrSlotIds: declaredQrSlots(pattern, note) } : {}),
    contentSlots: slots.filter((slot) => slot.role !== 'title').length,
    groups: semantics.groups,
    slots: slotBriefs(slots).map((slot) => ({
      slotId: slot.slotId,
      ...semantics.slots.find((entry) => entry.slotId === slot.slotId),
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
      pattern.imageSlots,
      pattern.qrCandidateSlots,
      pattern.slots.map((slot) => [slot.role, slot.sample.trim(), slot.maxChars, slot.maxLines]),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The catalog one variant plans and remaps with. This is the filter the generation step uses:
 * template pages, missing assets, picture frames and cramped slots leave before a variant takes
 * its two thirds, and covers stay the template's own covers.
 */
export function prepareVariantCatalog<T extends GenerationProfile['compositions'][number]>(
  profile: { compositions: readonly T[] },
  compositionNotes: readonly CompositionNote[],
  options: { imagesAvailable: boolean; variant: DeckVariant },
) {
  const notes = new Map(compositionNotes.map((note) => [note.patternId, note]));
  const compositions = profile.compositions.map((pattern) =>
    withCardHeadings(pattern, notes.get(pattern.patternId)),
  );
  const all = distinctCompositions(compositions);
  const hasMissingAsset = (pattern: (typeof all)[number]) =>
    notes
      .get(pattern.patternId)
      ?.requiredContent.some((item) =>
        item === 'image'
          ? !options.imagesAvailable &&
            (!declaredQrSlots(pattern, notes.get(pattern.patternId)).length ||
              (pattern.imageSlots ?? []).some(
                (slot) =>
                  !declaredQrSlots(pattern, notes.get(pattern.patternId)).includes(slot.slotId),
              ))
          : item === 'brand-asset' || item === 'screenshot',
      ) ?? false;
  const keepsSamplePhotos = (pattern: (typeof all)[number]) =>
    notes.get(pattern.patternId)?.special === true &&
    (pattern.imageSlots ?? []).some(
      (slot) =>
        slot.kind === 'photo' &&
        !declaredQrSlots(pattern, notes.get(pattern.patternId)).includes(slot.slotId),
    );
  const assetSafe = all.filter(
    (pattern) => !hasMissingAsset(pattern) && !keepsSamplePhotos(pattern),
  );
  const usable = assetSafe.filter((pattern) => !notes.get(pattern.patternId)?.skip);
  const readable = usable.length >= 3 ? usable : assetSafe;
  const textOnly = readable.filter(
    (pattern) =>
      !pattern.imageSlots?.some(
        (slot) =>
          slot.kind !== 'photo' &&
          !declaredQrSlots(pattern, notes.get(pattern.patternId)).includes(slot.slotId),
      ),
  );
  const distinct =
    options.imagesAvailable || textOnly.length < 3
      ? readable
      : readable.filter(
          (p) => textOnly.includes(p) || declaredQrSlots(p, notes.get(p.patternId)).length > 0,
        );
  if (!distinct.length)
    throw new Error('Template has no composition usable without an external image or asset.');
  const spacious = distinct.filter(
    (pattern) =>
      pattern.slots.some((slot) => slot.role === 'title' && slot.maxChars >= SHORT_CLAIM_CHARS) &&
      // A figure slot («42%») is short by design: three of them make a KPI slide, not a cramped one.
      writerSlots(pattern).every((slot) => slot.maxChars >= 12 || isFigureSample(slot.sample)),
  );
  const framing = distinct.filter((pattern) => {
    const note = notes.get(pattern.patternId);
    return note && !note.special && (note.kind === 'cover' || note.kind === 'closing');
  });
  const full = spacious.length
    ? distinct.filter((pattern) => spacious.includes(pattern) || framing.includes(pattern))
    : distinct;
  const titleSizes = full
    .flatMap((pattern) =>
      pattern.slots.filter((slot) => slot.role === 'title').map((slot) => slot.fontSize),
    )
    .sort((a, b) => a - b);
  const typicalTitle = titleSizes[Math.floor(titleSizes.length / 2)] ?? 24;
  const coversOf = (list: typeof full) =>
    list.filter(
      (pattern) =>
        pattern.slots.length <= 3 &&
        pattern.slots.some((slot) => slot.role === 'title' && slot.fontSize > typicalTitle),
    );
  const indexedCovers = full.filter((pattern) => notes.get(pattern.patternId)?.kind === 'cover');
  const plainCovers = indexedCovers.filter((pattern) => !notes.get(pattern.patternId)?.special);
  const covers = plainCovers.length
    ? plainCovers
    : indexedCovers.length
      ? indexedCovers
      : coversOf(full);
  return {
    notes,
    compositions,
    full,
    covers,
    catalog: variantCatalog(full, options.variant, covers),
  };
}

function boundedSlideSchema(
  pattern: GenerationProfile['compositions'][number],
  allowVisual = true,
) {
  const slots = allowVisual ? visualSlots(pattern) : [];
  const visual = slots.length
    ? z
        .union([
          slotTableSchema.extend({ slotId: z.enum(slots as [string, ...string[]]) }),
          slotChartSchema.extend({ slotId: z.enum(slots as [string, ...string[]]) }),
          slotNativeSchema.extend({ slotId: z.enum(slots as [string, ...string[]]) }),
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
          z
            .string()
            .describe(
              `At most ${fitChars(slot)} characters including spaces; at most ${slot.maxLines} lines.`,
            ),
        ]),
      ),
    ),
    speakerNotes: z.string(),
    visual,
  });
}

/** Check complete measurement relationships; unsupported provenance keeps the text fallback. */
export function groundedVisual(
  visual: SlotVisual | null | undefined,
  brief: string,
  preparedDatasets: readonly Dataset[] = [],
): SlotVisual | null {
  return verifyVisual(visual, brief, preparedDatasets);
}

function writingComposition(
  pattern: GenerationProfile['compositions'][number],
  variant: DeckVariant,
  note?: CompositionNote,
) {
  const semantics = compositionSemantics(pattern, note);
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    imageCount: pattern.imageCount,
    groups: semantics.groups,
    slots: slotBriefs(writerSlots(pattern), variant, semantics.slots).map((slot) => ({
      ...slot,
      ...semantics.slots.find((entry) => entry.slotId === slot.slotId),
    })),
  };
}

/** Empty visible slots: the card, pill or frame around them stays on the slide with no copy. */
export function emptySlots(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): string[] {
  const facts = factSlots(pattern);
  return (
    writableSlots(pattern)
      // A figure the template drew as a sample may stay empty: without a fact it is not written, and
      // the engine takes the empty shape off the slide.
      .filter(
        (slot) =>
          slot.slotId !== slide.visual?.slotId &&
          !facts.has(slot.slotId) &&
          !isFigureSample(slot.sample),
      )
      .filter((slot) => !(slide.texts.find((t) => t.slotId === slot.slotId)?.text ?? '').trim())
      .map((slot) => slot.slotId)
  );
}

const EMPTY_SLOT_MESSAGE =
  'This slot is empty, but its card or frame stays visible on the slide. Write a distinct point ' +
  'that supports the slide purpose and does not repeat any other slot. Follow the sample: a short ' +
  'label stays a short label, a numbering sample like 01 continues the numbering. A field for ' +
  'facts the brief does not give (a contact, a name, a date) stays empty: return empty strings.';

/**
 * Slots for facts about the talk: their sample names the field («Спикер», «Контакт»). Such a
 * fact is never inferred from the subject, so the slot shows only what the brief states.
 */
export function factSlots(pattern: GenerationProfile['compositions'][number]): Set<string> {
  return new Set(
    writableSlots(pattern)
      .filter((slot) => slot.role !== 'title')
      .filter((slot) => {
        const label = normalized(slot.sample).replace(/\s*\d+$/, '');
        return FIELD_LABELS.has(label) && !DATE_FIELDS.has(label);
      })
      .map((slot) => slot.slotId),
  );
}

/** The slide with every fact slot holding words the brief does not state emptied. */
export function keepStatedFacts(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
  brief: string,
): ComposedSlide {
  const facts = factSlots(pattern);
  if (!facts.size) return slide;
  const stated = ` ${normalized(brief)} `;
  return {
    ...slide,
    texts: slide.texts.map((t) =>
      facts.has(t.slotId) && !stated.includes(` ${normalized(t.text)} `) ? { ...t, text: '' } : t,
    ),
  };
}

/** The slide with every non-title slot that still shows the template's own label emptied. */
export function clearEchoes(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
  brief: string,
): ComposedSlide {
  const labels = new Set(
    writerSlots(pattern)
      .filter((slot) => slot.role !== 'title')
      .filter((slot) =>
        echoesSample(slide.texts.find((t) => t.slotId === slot.slotId)?.text ?? '', slot, brief),
      )
      .map((slot) => slot.slotId),
  );
  if (!labels.size) return slide;
  return {
    ...slide,
    texts: slide.texts.map((t) => (labels.has(t.slotId) ? { ...t, text: '' } : t)),
  };
}

/** Title and fit problems block a slide; an empty body slot is repaired but does not block. */
/**
 * Defects code can see in written copy that fit its box: the same phrase in two slots of one
 * slide, and a word longer than one line of its box, which the renderer breaks mid-word. Both are
 * sent to the rewriter; neither blocks the deck if the rewrite does not cure it.
 */
export function copyDefects(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
  context: CopyContext = {},
): Map<string, string> {
  const defects = new Map<string, string>();
  const seen = new Map<string, string>();
  const slots = writerSlots(pattern);
  const semantics = compositionSemantics(pattern, context.note);
  const textOf = (slotId: string) =>
    slide.texts.find((t) => t.slotId === slotId)?.text.trim() ?? '';
  for (const slot of slots) {
    const policySlot = {
      ...slot,
      ...semantics.slots.find((entry) => entry.slotId === slot.slotId),
    };
    if (slot.slotId === slide.visual?.slotId) continue;
    const text = textOf(slot.slotId);
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
    if (NUMBERING.test(text) && !NUMBERING.test(slot.sample)) {
      defects.set(
        slot.slotId,
        `"${text}" is a bare number, but this field holds words: the template's sample was ` +
          `"${slot.sample.trim()}". Numbering is drawn elsewhere; write the name of this point.`,
      );
      continue;
    }
    const stale = staleYears(text, context);
    if (stale.length) {
      defects.set(
        slot.slotId,
        `The year ${stale.join(', ')} is past and the brief does not name it: it is the ` +
          "template's sample or made up. Remove it, or use a year the brief names.",
      );
      continue;
    }
    if (slot.role !== 'title' && echoesSample(text, slot, context.brief)) {
      defects.set(
        slot.slotId,
        `"${text}" is the template's own label for this field, not content. Write what the ` +
          'brief says for it; if the brief has nothing for it (a contact, a name), return an ' +
          'empty string.',
      );
      continue;
    }
    const [point = '', ...rest] = text.split('\n');
    const heading = rest.length
      ? headingAbove(slot, slots).find((other) => repeatsHeading(point, textOf(other.slotId)))
      : undefined;
    if (heading) {
      defects.set(
        slot.slotId,
        `The first point "${point.trim()}" repeats the heading "${textOf(heading.slotId)}" of ` +
          'its card. Drop it and start the list with a real point.',
      );
      continue;
    }
    const perLine = Math.floor(slot.maxChars / Math.max(1, slot.maxLines));
    const long = text.split(/\s+/).find((word) => word.length > perLine);
    if (perLine >= 6 && long)
      defects.set(
        slot.slotId,
        `The word "${long}" is longer than one line of this box (${perLine} characters) and ` +
          'breaks mid-word. Rephrase with shorter words.',
      );
    else if (context.variant && text.length < minChars(policySlot, context.variant))
      defects.set(
        slot.slotId,
        thinMessage(text.length, minChars(policySlot, context.variant), fitChars(slot)),
      );
  }
  return defects;
}

function blockingProblems(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
  context: CopyContext = {},
): string[] {
  return validateBindings(slide, pattern, context).filter(
    (problem) => !problem.startsWith('Fill empty slot') && !problem.startsWith('Revise slot'),
  );
}

function slotCorrections(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
  context: CopyContext = {},
) {
  const empty = new Set(emptySlots(slide, pattern));
  const defects = copyDefects(slide, pattern, context);
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
  const deckCopy = new Map<number, z.infer<ReturnType<typeof boundedSlideSchema>>>();
  const datasetEvidence = boundedDatasetEvidence(deps.preparedDatasets ?? []);
  const writerTask = (inputData: z.infer<typeof taskSchema>) => {
    const { title: deckTitle, canonicalComposition, ...task } = inputData;
    const mode = deps.variantCopyMode ?? 'independent';
    const base =
      mode === 'shared' ? (canonicalComposition ?? inputData.composition) : inputData.composition;
    const variant = mode === 'shared' ? 'balanced' : (deps.variant ?? 'balanced');
    const note = deps.notes?.find((entry) => entry.patternId === base.patternId);
    const qr = (note?.qrSlotIds?.length ?? 0) > 0;
    const allowVisual = !qr && visualSlots(base).length > 0;
    const input = {
      ...task,
      deckTitle,
      originalSourceTexts: sourceBriefTexts(task.brief),
      ...(deps.preparedDatasets?.length
        ? {
            datasetFacts: datasetEvidence.facts,
            datasetTables: datasetEvidence.tables,
            datasetWithheld: datasetEvidence.withheld,
          }
        : {}),
      variant,
      variantCopyMode: mode,
      outlineIsSource: deps.outlineIsSource !== false,
      composition: writingComposition(base, variant, note),
      visualSlots: allowVisual ? visualSlots(base) : [],
    };
    const instructions = writerPrompt(
      deps.deckWriterInstructions === undefined ? deps.writerInstructions : '',
      deps.writerModules,
      {
        audience: task.audience,
        goal: task.goal,
        variant,
        output: qr ? 'qr' : allowVisual ? 'native' : 'text',
      },
    );
    return {
      base,
      variant,
      note,
      allowVisual,
      input,
      instructions,
      output: qr ? 'qr' : allowVisual ? 'native' : 'text',
    };
  };
  const plan = createStep({
    id: 'plan-compositions',
    inputSchema,
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
      for (const source of datasetEvidence.withheld)
        await deps.onWarning?.(
          `Dataset ${source.datasetId}/${source.sheetId}: ${source.reason}; visual evidence withheld, keep text fallback.`,
        );
      const variant = deps.variant ?? 'balanced';
      const prepared = prepareVariantCatalog(inputData.profile, deps.notes ?? [], {
        imagesAvailable: deps.imagesAvailable === true,
        variant,
      });
      const { compositions, full, catalog, covers, notes } = prepared;
      // The story is planned once for all three variants, on the full catalog; each variant then
      // lays the same slides out on its own compositions (remapPlan).
      const outline = inputData.outline ?? null;
      const slideCount = outline?.slides.length ?? inputData.slideCount;
      const qrSourceBrief =
        deps.qrSourceBrief ??
        (outline && deps.outlineIsSource !== false
          ? JSON.stringify({ brief: inputData.brief, approvedOutline: outline })
          : inputData.brief);
      const computePlan = async () => {
        const outlineLayoutOnly = Boolean(
          outline && deps.outlineIsSource !== false && deps.deckWriterInstructions !== undefined,
        );
        // Legacy plans remain readable; newly generated plans must expose their facts in one call.
        const plannerSchema = outlineLayoutOnly
          ? compositionPlanSchema.extend({
              slides: z
                .array(
                  compositionPlanSchema.shape.slides.element.omit({
                    purpose: true,
                    requiredClaims: true,
                  }),
                )
                .length(outline?.slides.length ?? 0),
            })
          : deps.writerModules && !(outline && deps.outlineIsSource !== false)
            ? compositionPlanSchema.extend({
                slides: z
                  .array(
                    compositionPlanSchema.shape.slides.element.extend({
                      requiredClaims: z.array(requiredSlideClaimSchema).min(1).max(40),
                    }),
                  )
                  .min(5)
                  .max(60),
              })
            : compositionPlanSchema;
        const plan = async (
          corrections?: Record<string, unknown>,
          previous?: z.infer<typeof compositionPlanSchema>,
        ) => {
          const selected = await deps.provider.generate(
            'planner',
            deps.plannerInstructions,
            {
              brief: inputData.brief,
              ...(deps.preparedDatasets?.length
                ? {
                    datasetFacts: datasetEvidence.facts,
                    datasetTables: datasetEvidence.tables,
                    datasetWithheld: datasetEvidence.withheld,
                  }
                : {}),
              slideCount,
              ...(outline ? { outline } : {}),
              outlineIsSource: deps.outlineIsSource !== false,
              ...(outlineLayoutOnly ? { outlineLayoutOnly: true } : {}),
              imagesAvailable: deps.imagesAvailable === true,
              allowedQrUrls: sourceQrUrls(qrSourceBrief),
              catalog: full.map((pattern) =>
                plannerComposition(pattern, notes.get(pattern.patternId)),
              ),
              coverPatternIds: covers.map((p) => p.patternId),
              ...(previous ? { previous } : {}),
              ...(corrections ? { corrections } : {}),
            },
            plannerSchema,
            deps.signal,
          );
          return compositionPlanSchema.parse({
            ...selected,
            slides: selected.slides.map((slide, index) => ({
              ...slide,
              ...(outlineLayoutOnly ? { purpose: outline?.slides[index]?.title } : {}),
            })),
          });
        };
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
        const source = [
          inputData.brief,
          ...(deps.outlineIsSource !== false ? (outline?.slides ?? []) : []).flatMap((slide) => [
            slide.title,
            ...slide.points,
          ]),
        ].join('\n');
        const evidenceCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          const missing = missingRequiredContent(result, notes, source);
          return missing.length ? { missingRequiredContent: missing } : undefined;
        };
        // A figure the planner computed or guessed («80%», a threshold) becomes a required claim
        // the writer must keep, and no rewrite can then take it off the slide.
        const sourceFigures = figuresOf(source);
        const figureCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          const unsourced = result.slides.flatMap((slide, index) => {
            const claims = (slide as { requiredClaims?: { text: string }[] }).requiredClaims ?? [];
            const figures = [
              ...figuresOf([slide.purpose, ...claims.map((claim) => claim.text)].join('\n')),
            ].filter((figure) => !sourceFigures.has(figure));
            return figures.length ? [{ slideIndex: index, figures }] : [];
          });
          return unsourced.length
            ? {
                unsourcedFigures: unsourced,
                message:
                  'These figures are not in brief. Replace each with a figure brief states ' +
                  'verbatim (its counts and series lines for tables) together with what it ' +
                  'measures. Never compute shares, differences or thresholds.',
              }
            : undefined;
        };
        // Tables read from a file come with ready series: the deck shows them as charts, and a
        // chart is drawn only for a slide whose purpose quotes a series on a composition with room.
        const chartPatterns = full.filter((pattern) => chartSlot(pattern) !== undefined);
        const chartCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          if (!chartPatterns.length || !seriesFacts(inputData.brief).length) return undefined;
          const charted = result.slides.filter((slide) => {
            const pattern = chartPatterns.find((entry) => entry.patternId === slide.patternId);
            const slot = pattern && chartSlot(pattern);
            return slot && plannedSeriesChart(slide.purpose, inputData.brief, slot);
          }).length;
          return charted >= Math.min(CHART_SLIDES, result.slides.length - 2)
            ? undefined
            : {
                chartSlides: CHART_SLIDES,
                chartPatternIds: chartPatterns.map((pattern) => pattern.patternId),
                message:
                  'Give chartSlides slides one of chartPatternIds, each built on one ready ' +
                  'series of brief: quote its line whole in the purpose, the name before the ' +
                  'colon and every value («cloud_cover, среднее: 0 — 43,33, 1 — 30,83»). ' +
                  'Choose series whose values clearly differ.',
              };
        };
        const quoteCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          const unquoted = result.slides.flatMap((slide, index) =>
            (
              (slide as { requiredClaims?: z.infer<typeof requiredSlideClaimSchema>[] })
                .requiredClaims ?? []
            )
              .filter((claim) => claim.source.sourceId === 'brief')
              .filter((claim) => !inputData.brief.includes(claim.source.quote))
              .map((claim) => ({ slideIndex: index, id: claim.id, quote: claim.source.quote })),
          );
          return unquoted.length
            ? {
                unquotedClaims: unquoted,
                message:
                  'These quotes do not occur in brief. Copy each quote character for character ' +
                  'from brief, or drop the claim.',
              }
            : undefined;
        };
        let result: z.infer<typeof compositionPlanSchema>;
        try {
          result = await plan();
        } catch (error) {
          deps.signal.throwIfAborted();
          if (!(error instanceof z.ZodError)) throw error;
          result = await plan({
            minimumSlideCount: 5,
            exactSlideCount: slideCount,
            message: 'Return 5 to 60 slides in auto mode, or exactly the requested count.',
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
          ...evidenceCorrections(result),
          // A user's outline fixes what each slide says: only its layouts are planned here.
          ...(!outlineLayoutOnly
            ? {
                ...varietyCorrections(result),
                ...figureCorrections(result),
                ...chartCorrections(result),
              }
            : {}),
          ...quoteCorrections(result),
        };
        if (Object.keys(corrections).length) result = await plan(corrections, result);
        if (slideCount !== null && result.slides.length !== slideCount)
          throw new Error('Planner returned the wrong slide count.');
        if (coverCorrections(result))
          throw new Error('Planner did not select a cover composition.');
        // The planner was asked once to vary the layouts; what it kept repeating, code spreads over
        // the compositions that hold the same points. Where the template has none, the slide keeps
        // its layout and the report says so.
        const varied = diversifyPlan(result.slides, full, notes, {
          limit: patternUseLimit(full.length, result.slides.length),
          blocks: (p) => writerSlots(p).filter((s) => s.role !== 'title').length,
          capacity: (p) =>
            writerSlots(p)
              .filter((s) => s.role !== 'title')
              .reduce((sum, s) => sum + s.maxChars, 0),
          structure: compositionStructure,
          allowsMove: (index, to) =>
            allowsDataMove(result.slides, inputData.brief, full, index, to),
        });
        result = { ...result, slides: varied.slides };
        if (varied.repeated.length) {
          await deps.onWarning?.(
            `Слайды ${varied.repeated.map((r) => r.index + 1).join(', ')} остались на макете, ` +
              'который в колоде уже повторяется: в шаблоне нет другого макета с тем же числом ' +
              'пунктов. Разнообразие ограничено шаблоном.',
          );
        }
        result = { ...result, slides: withDataLayouts(result.slides, full, inputData.brief) };
        // Still a layout for a speaker, a contact or a screenshot the source does not have: the
        // slide moves to one that needs none, instead of the deck failing.
        result = withoutMissingContent(
          result,
          missingRequiredContent(result, notes, source),
          full,
          notes,
          deps.imagesAvailable === true,
        );
        result = outline ? keepOutline(result, outline) : result;
        return {
          ...result,
          slides: result.slides.map((slide, index) => {
            const userSlide = deps.outlineIsSource !== false ? outline?.slides[index] : undefined;
            // User corrections replace model-selected claims, including obsolete numeric values.
            const requiredClaims = userSlide
              ? [userSlide.title, ...userSlide.points].map((text, claimIndex) => ({
                  id: `slide-${index}-claim-${claimIndex}`,
                  text,
                  source: { sourceId: 'user-outline' as const, quote: text },
                }))
              : slide.requiredClaims;
            // A claim whose quote is not in its source stays off the slide: the writer is never
            // told to assert what nothing supports.
            const supported = requiredClaims.filter((claim) => {
              const sourceText =
                claim.source.sourceId === 'brief'
                  ? inputData.brief
                  : userSlide
                    ? [userSlide.title, ...userSlide.points].join('\n')
                    : '';
              return sourceText.includes(claim.source.quote);
            });
            if (new Set(requiredClaims.map((claim) => claim.id)).size !== requiredClaims.length)
              throw new Error('Planner returned duplicate required claim ids.');
            return {
              ...slide,
              ...(outlineLayoutOnly && userSlide ? { purpose: userSlide.title } : {}),
              requiredClaims: supported,
            };
          }),
        };
      };
      const sharedResult = deps.sharedPlan
        ? await deps.sharedPlan.once(computePlan)
        : await computePlan();
      const result = await safeQrPlan(
        sharedResult,
        compositions,
        notes,
        qrSourceBrief,
        deps.imagesAvailable === true,
        deps.signal,
        full,
      );
      const dataNeeds = result.slides.map((slide, index) =>
        dataLayoutNeed(slide.purpose, inputData.brief, index, result.slides.length),
      );
      const remapped = remapPlan(
        result.slides.map((slide) => slide.patternId),
        full,
        catalog,
        variant,
        covers,
        notes,
        deps.layoutRemapPolicy ?? 'density',
        dataNeeds,
      );
      // The variant's own layouts repeat as the plan's did, and the same share applies: what the
      // remap sent to one layout over and over goes to the others of this variant's set.
      const layouts = diversifyPlan(
        remapped.map((patternId) => ({ patternId })),
        full,
        notes,
        {
          limit: patternUseLimit(full.length, remapped.length),
          pool: catalog,
          bias: variant === 'dense' ? 'heavy' : variant === 'airy' ? 'light' : 'near',
          blocks: (p) => writerSlots(p).filter((s) => s.role !== 'title').length,
          capacity: (p) =>
            writerSlots(p)
              .filter((s) => s.role !== 'title')
              .reduce((sum, s) => sum + s.maxChars, 0),
          structure: compositionStructure,
          allowsMove: (index, to) =>
            allowsDataMove(
              remapped.map((patternId, slideIndex) => ({
                patternId,
                purpose: result.slides[slideIndex]?.purpose ?? '',
              })),
              inputData.brief,
              full,
              index,
              to,
            ),
        },
      ).slides.map((slide) => slide.patternId);
      // A validated QR binding remains on its original composition in all three variants.
      result.slides.forEach((slide, index) => {
        if (slide.qrRequests?.length) layouts[index] = slide.patternId;
      });
      const tasks = result.slides.map((slide, index) => {
        const canonicalComposition = compositions.find((p) => p.patternId === slide.patternId);
        let composition = compositions.find((p) => p.patternId === layouts[index]);
        if (!composition) throw new Error('Planner selected an unknown template composition.');
        if (canonicalComposition) {
          // A deterministic one-to-one mapping cannot drop a mandatory fact. A poorer template
          // keeps its original composition instead of discarding or inventing content blocks.
          if (
            (visualSlots(canonicalComposition).length > 0 &&
              visualSlots(composition).length === 0) ||
            !semanticSlotMap(
              { ...canonicalComposition, slots: writerSlots(canonicalComposition) },
              { ...composition, slots: writerSlots(composition) },
              notes.get(canonicalComposition.patternId),
              notes.get(composition.patternId),
            )
          )
            composition = canonicalComposition;
        }
        // Choose room before bindings exist: an approved content slide cannot be
        // squeezed into a divider just because both carry a title.
        if (
          slide.requiredClaims.length &&
          !slide.qrRequests?.length &&
          (deps.variantCopyMode ?? 'independent') === 'independent'
        ) {
          const selected = composition;
          const sourceNote = notes.get(selected.patternId);
          const available = new Set(sourceNote?.requiredContent ?? []);
          const need = dataNeeds[index];
          const selection = {
            selected,
            candidates: full,
            variant,
            title: outline?.slides[index]?.title ?? slide.purpose,
            claims: slide.requiredClaims,
            writableSlots: writerSlots,
            compatible: (candidate: typeof selected) => {
              if (need && !fitsDataLayout(candidate, need)) return false;
              if (candidate.patternId === selected.patternId) return true;
              const note = notes.get(candidate.patternId);
              if (sourceNote?.special || note?.special || note?.skip) return false;
              if ((note?.requiredContent ?? []).some((item) => !available.has(item))) return false;
              if (index === 0 && !covers.some((cover) => cover.patternId === candidate.patternId))
                return false;
              if (index > 0 && FRAMING_KINDS.has(note?.kind ?? 'other')) return false;
              return visualSlots(selected).length === 0 || visualSlots(candidate).length > 0;
            },
          };
          composition =
            ampleComposition(selection) ??
            (index === 0
              ? ampleComposition({
                  ...selection,
                  compatible: (candidate) => {
                    const note = notes.get(candidate.patternId);
                    return (
                      !note?.special &&
                      !note?.skip &&
                      !(note?.requiredContent ?? []).some((item) => !available.has(item)) &&
                      !FRAMING_KINDS.has(note?.kind ?? 'other')
                    );
                  },
                })
              : undefined) ??
            selected;
        }
        if (!slide.qrRequests?.length)
          composition = preserveDataLayout(composition, full, dataNeeds[index], variant);
        return {
          ...slide,
          patternId: composition.patternId,
          narrative: result.slides.map((s) => s.purpose),
          ...(outline?.slides[index] && deps.outlineIsSource !== false
            ? {
                slideTitle: outline.slides[index].title,
                approvedSlide: outline.slides[index],
              }
            : {}),
          index,
          total: result.slides.length,
          audience: result.audience,
          goal: result.goal,
          title: result.title,
          brief:
            outline && deps.outlineIsSource !== false
              ? JSON.stringify({ brief: inputData.brief, approvedOutline: outline })
              : inputData.brief,
          composition,
          ...((deps.variantCopyMode ?? 'independent') === 'shared' && canonicalComposition
            ? { canonicalComposition }
            : {}),
        };
      });
      // QR uses every task, including special layouts; ordinary illustrations keep their
      // existing callback semantics, with the QR picture ids removed from the frames.
      await deps.onQrPlan?.(tasks);
      deps.onPlan?.(
        tasks
          .filter((task) => !notes.get(task.composition.patternId)?.special)
          .map((task) => ({
            ...task,
            composition: {
              ...task.composition,
              imageSlots: (task.composition.imageSlots ?? []).filter(
                (slot) =>
                  !declaredQrSlots(
                    task.composition,
                    notes.get(task.composition.patternId),
                  ).includes(slot.slotId),
              ),
            },
          })),
      );
      return tasks;
    },
  });
  const writeDeck = createStep({
    id: 'write-deck-variant',
    inputSchema: z.array(taskSchema),
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
      if (deps.deckWriterInstructions === undefined) return inputData;
      deps.signal.throwIfAborted();
      deckCopy.clear();
      const jobs = inputData.map(writerTask);
      const first = jobs[0];
      if (!first) throw new Error('The deck has no slides to write.');
      const schema = templateDeckCopySchema.extend({
        slides: z.strictObject(
          Object.fromEntries(
            jobs.map((job) => [
              String(job.input.index),
              boundedSlideSchema(job.base, job.allowVisual),
            ]),
          ),
        ),
      });
      // The brief and datasets are shared context, sent once for the whole variant.
      const {
        brief,
        deckTitle,
        audience,
        goal,
        variant,
        variantCopyMode,
        outlineIsSource,
        datasetFacts,
        datasetTables,
        datasetWithheld,
      } = first.input;
      const input = {
        brief,
        originalSourceTexts: first.input.originalSourceTexts,
        deckTitle,
        audience,
        goal,
        variant,
        variantCopyMode,
        outlineIsSource,
        ...(datasetFacts ? { datasetFacts, datasetTables, datasetWithheld } : {}),
        writingRules: Object.fromEntries(jobs.map((job) => [job.output, job.instructions])),
        slides: jobs.map(({ input: slide, output }) => ({
          index: slide.index,
          purpose: slide.purpose,
          requiredClaims: slide.requiredClaims,
          ...(slide.approvedSlide ? { approvedSlide: slide.approvedSlide } : {}),
          composition: slide.composition,
          visualSlots: slide.visualSlots,
          writingRules: output,
        })),
      };
      const instructions = deps.deckWriterInstructions;
      const compute = () =>
        deps.provider.generate('writer', instructions, input, schema, deps.signal);
      const result =
        variantCopyMode === 'shared' && deps.sharedContent
          ? await deps.sharedContent.once(
              { scope: 'deck-variant-v1', instructions, input },
              compute,
            )
          : await compute();
      deps.signal.throwIfAborted();
      for (const task of inputData) {
        const copy = result.slides[String(task.index)];
        if (!copy) throw new Error(`Missing written slide ${task.index + 1}.`);
        deckCopy.set(task.index, copy);
      }
      return inputData;
    },
  });
  const write = createStep({
    id: 'write-template-slide',
    inputSchema: taskSchema,
    outputSchema: writtenSchema,
    execute: async ({ inputData }) => {
      let slide: ComposedSlide | undefined;
      // The deck title goes under its own name: as `title` the writer took it for the title
      // of the slide and put it on slide after slide.
      const { base, note, allowVisual, input: writeInput, instructions } = writerTask(inputData);
      const mode = deps.variantCopyMode ?? 'independent';
      const compute = () =>
        deps.provider.generate(
          'writer',
          instructions,
          writeInput,
          boundedSlideSchema(base, allowVisual),
          deps.signal,
        );
      const accepted = deckCopy.get(inputData.index);
      if (deps.deckWriterInstructions !== undefined && !accepted)
        throw new Error('The deck writer did not produce this slide.');
      let raw =
        accepted ??
        (mode === 'shared' && deps.sharedContent
          ? await deps.sharedContent.once({ instructions, input: writeInput }, compute)
          : await compute());
      if (base.patternId !== inputData.composition.patternId) {
        const map = semanticSlotMap(
          { ...base, slots: writerSlots(base) },
          { ...inputData.composition, slots: writerSlots(inputData.composition) },
          note,
          deps.notes?.find((entry) => entry.patternId === inputData.composition.patternId),
        );
        if (!map) throw new Error('Composition cannot preserve semantic groups.');
        const visual = raw.visual as SlotVisual | null;
        raw = {
          ...raw,
          patternId: inputData.composition.patternId,
          textsBySlot: Object.fromEntries(
            Object.entries(raw.textsBySlot).map(([id, text]) => [map.get(id) ?? id, text]),
          ),
          visual: visual ? { ...visual, slotId: map.get(visual.slotId) ?? visual.slotId } : null,
        };
      }
      let visual = groundedVisual(
        raw.visual as SlotVisual | null,
        inputData.brief,
        datasetEvidence.datasets,
      );
      if (raw.visual && !visual)
        await deps.onWarning?.(
          `Slide ${inputData.index + 1}: visual provenance is unknown; keeping text fallback.`,
        );
      // A slide planned around a ready series shows that series, whatever the writer drew.
      const seriesSlot = allowVisual ? chartSlot(inputData.composition) : undefined;
      const planned = seriesSlot
        ? plannedSeriesChart(inputData.purpose, inputData.brief, seriesSlot)
        : null;
      if (planned) visual = planned;
      if (visual?.kind === 'native') visual = { ...visual, variant: deps.variant ?? 'balanced' };
      const texts = raw.textsBySlot as Record<string, string | undefined>;
      const context: CopyContext = {
        ...(deps.notes?.find((entry) => entry.patternId === inputData.composition.patternId)
          ? {
              note: deps.notes.find((entry) => entry.patternId === inputData.composition.patternId),
            }
          : {}),
        brief: inputData.brief,
        variant: deps.variant ?? 'balanced',
        ...(deps.today ? { today: deps.today } : {}),
      };
      const numbers = numberedSlots(inputData.composition);
      const dates = datedSlots(inputData.composition, context);
      slide = {
        patternId: raw.patternId,
        speakerNotes: raw.speakerNotes,
        // Numbering and dates come from code; mirrors and the slot a visual replaces carry no
        // text.
        texts: inputData.composition.slots.map((slot) => ({
          slotId: slot.slotId,
          text:
            visual?.slotId === slot.slotId
              ? ''
              : (numbers.get(slot.slotId) ??
                dates.get(slot.slotId) ??
                (texts[slot.slotId] ?? '').trim()),
        })),
        visual,
      };
      slide = keepStatedFacts(slide, inputData.composition, inputData.brief);
      // Whole-deck writing is followed by one consolidated audit/repair stage, not a
      // second wave of speculative per-slide agents before that audit.
      for (
        let attempt = 0;
        attempt < (deps.deckWriterInstructions === undefined ? 2 : 0);
        attempt++
      ) {
        if (!validateBindings(slide, inputData.composition, context).length) break;
        const current: ComposedSlide = slide;
        slide = await rewriteSlide(deps, {
          index: inputData.index,
          brief: inputData.brief,
          purpose: inputData.purpose,
          requiredClaims: inputData.requiredClaims,
          ...(inputData.approvedSlide ? { approvedSlide: inputData.approvedSlide } : {}),
          composition: inputData.composition,
          previous: current,
          corrections: slotCorrections(current, inputData.composition, context),
        });
        // A rewrite that changed nothing means the model cannot cure the slide: stop drawing and
        // keep the copy, so the variant still completes and the audit reports what is left.
        if (slide.texts.every((t, index) => t.text === current.texts[index]?.text)) break;
      }
      if (!slide) throw new Error(`Slide ${inputData.index + 1} was never written.`);
      // The opening and the closing carry fields for facts a brief rarely has: a contact, a
      // speaker, a place. Such a field still showing the template's label is cleared: an empty
      // line reads as nothing, a label reads as a slide nobody finished.
      const kind = deps.notes?.find((n) => n.patternId === inputData.composition.patternId)?.kind;
      if (
        kind === 'cover' ||
        kind === 'closing' ||
        inputData.index === 0 ||
        inputData.index === inputData.total - 1
      )
        slide = clearEchoes(slide, inputData.composition, inputData.brief);
      // The rewriter could not cure every blocking defect, but the deck must still be produced:
      // three variants are mandatory, so a stubborn slide becomes a warning, not a failed run.
      for (const problem of blockingProblems(slide, inputData.composition, context))
        await deps.onWarning?.(`Slide ${inputData.index + 1}: ${problem}`);
      completed++;
      await deps.onProgress?.(completed, inputData.total);
      return {
        index: inputData.index,
        title: inputData.title,
        purpose: inputData.purpose,
        requiredClaims: inputData.requiredClaims,
        ...(inputData.approvedSlide ? { approvedSlide: inputData.approvedSlide } : {}),
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
    .then(writeDeck)
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
      if (
        !planned ||
        [planned.title, ...planned.points].every((claim) => slide.purpose.includes(claim))
      )
        return slide;
      const points = planned.points.join('; ');
      return {
        ...slide,
        purpose: points ? `${planned.title} — ${points}` : planned.title,
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

  /**
   * `known` — the plan the build already settled on: a variant built again tells the same story
   * and does not call the planner. `onReady` hears the plan once it is made, to keep it.
   */
  constructor(
    known?: z.infer<typeof compositionPlanSchema>,
    private readonly onReady?: (plan: z.infer<typeof compositionPlanSchema>) => Promise<void>,
  ) {
    if (known) this.pending = Promise.resolve(known);
  }

  once(
    compute: () => Promise<z.infer<typeof compositionPlanSchema>>,
  ): Promise<z.infer<typeof compositionPlanSchema>> {
    this.pending ??= compute().then(async (plan) => {
      // Accepted work is durable before it is handed to another stage.
      await this.onReady?.(plan);
      return plan;
    });
    return this.pending;
  }
}

/** Shared accepted narrative copy. Rejections are never cached as a successful task. */
export class SharedContent {
  private readonly pending = new Map<string, Promise<unknown>>();
  async once<T>(task: unknown, compute: () => Promise<T>): Promise<T> {
    const key = dependencyKey(task);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = compute();
      this.pending.set(key, pending);
    }
    try {
      return structuredClone(await pending) as T;
    } catch (error) {
      this.pending.delete(key);
      throw error;
    }
  }
}

/** The least room a variant's layout keeps of the planned one's, so the points still fit. */
const MIN_CAPACITY_SHARE = 0.6;
/** The most room more than the planned layout's that airy takes, so a slide is not left bare. */
const MAX_AIRY_GROWTH = 1.6;

/** Kinds that frame a deck rather than carry its points. */
const FRAMING_KINDS: ReadonlySet<string> = new Set(['cover', 'section', 'closing']);

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
  policy: LayoutRemapPolicy = 'density',
  needs: readonly (DataLayoutNeed | undefined)[] = [],
): string[] {
  if (policy === 'conceptual')
    return conceptualLayouts(patternIds, full, variant, covers, notes, needs);
  if (variant === 'balanced') return [...patternIds];
  // Blocks as the planner counted them: numbering and mirrored copies are not points.
  const content = (p: T) => writerSlots(p).filter((s) => s.role !== 'title');
  const capacity = (p: T) => content(p).reduce((sum, s) => sum + s.maxChars, 0);
  const blocks = (p: T) => content(p).length;
  const coverIds = new Set(covers.map((p) => p.patternId));
  const special = (id: string) => notes.get(id)?.special === true;
  const addsRequirements = (candidate: string, planned: string) => {
    const available = new Set(notes.get(planned)?.requiredContent ?? []);
    return (notes.get(candidate)?.requiredContent ?? []).some((item) => !available.has(item));
  };
  // A layout for code or a device screen is never a stand-in for an ordinary slide, and the
  // planner chose a special one for its content, so that one stays in every variant.
  const pool = catalog.filter((p) => !coverIds.has(p.patternId) && !special(p.patternId));
  // A cover, a divider or a closing frames the deck and holds a line or two; a content slide
  // laid out on one loses its points, and a divider laid out as cards gains made-up ones.
  const framing = (id: string) => FRAMING_KINDS.has(notes.get(id)?.kind ?? 'other');
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
    const need = needs[index];
    const compatible = pool.filter(
      (p) =>
        (!need || fitsDataLayout(p, need)) &&
        !addsRequirements(p.patternId, id) &&
        (visualSlots(planned).length === 0 || visualSlots(p).length > 0) &&
        framing(p.patternId) === framing(id) &&
        semanticSlotMap(
          { ...planned, slots: writerSlots(planned) },
          { ...p, slots: writerSlots(p) },
          notes.get(id),
          notes.get(p.patternId),
        ) !== undefined,
    );
    if (!compatible.length) return id;
    // The same number of blocks, or one more or fewer: the planned points still fit. Without
    // such a layout in this variant's set the slide keeps the one the planner chose for it.
    const sameCount = compatible.filter((p) => blocks(p) === blocks(planned));
    // Lighter, not emptier: a layout holding far less than the planned one drops the slide's
    // points, as a quote layout would for four figures. A strict block-count policy does not
    // borrow a layout one block away: the planned composition stays when none matches exactly.
    const near = (
      sameCount.length
        ? sameCount
        : policy === 'preserve-block-count'
          ? []
          : compatible.filter((p) => blocks(p) > 0 && Math.abs(blocks(p) - blocks(planned)) <= 1)
    ).filter((p) =>
      variant === 'dense'
        ? capacity(p) >= capacity(planned)
        : capacity(p) <= capacity(planned) && capacity(p) >= capacity(planned) * MIN_CAPACITY_SHARE,
    );
    // The planned layout is already the lightest that holds the points: airy then takes the
    // nearest roomier one rather than the same layout as balanced. It writes less text than the
    // layout holds, which is airy, and the variants differ by layout, not only by wording. Dense
    // never goes to a lighter layout: it has more to say than that one holds.
    const alone = near.every((p) => p.patternId === id);
    const roomier =
      variant === 'airy' && alone
        ? sameCount.filter(
            (p) =>
              p.patternId !== id &&
              capacity(p) > capacity(planned) &&
              capacity(p) <= capacity(planned) * MAX_AIRY_GROWTH &&
              compositionStructure(p) !== compositionStructure(planned),
          )
        : [];
    if (alone && !roomier.length) return id;
    // The indexer's kind keeps a process a process and cards cards when the template has both.
    const kind = notes.get(planned.patternId)?.kind;
    const pick = alone && roomier.length ? roomier : near;
    const sameKind = pick.filter((p) => kind && notes.get(p.patternId)?.kind === kind);
    const same = sameKind.length ? sameKind : pick;
    const ranked = [...same].sort((a, b) =>
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

/** Measured geometry and hierarchy, independent of names, colors and template identity. */
export function compositionStructure(pattern: GenerationProfile['compositions'][number]): string {
  return dependencyKey(
    writerSlots(pattern).map((slot) => ({
      role: slot.role,
      box: slot.box ?? null,
      hierarchy: slot.fontSize / Math.max(...pattern.slots.map((item) => item.fontSize)),
    })),
  );
}

/** Three coordinated composition plans. Sparse catalogs explicitly retain the only safe layout. */
export function conceptualLayouts<T extends GenerationProfile['compositions'][number]>(
  patternIds: readonly string[],
  full: readonly T[],
  variant: DeckVariant,
  covers: readonly T[],
  notes: ReadonlyMap<string, CompositionNote>,
  needs: readonly (DataLayoutNeed | undefined)[] = [],
): string[] {
  if (variant === 'balanced') return [...patternIds];
  const coverIds = new Set(covers.map((pattern) => pattern.patternId));
  const signature = (pattern: T) =>
    [true, false]
      .map(
        (title) => writerSlots(pattern).filter((slot) => (slot.role === 'title') === title).length,
      )
      .join(':');
  const body = (pattern: T) => writerSlots(pattern).filter((slot) => slot.role !== 'title');
  const hierarchy = (pattern: T) => {
    const title = pattern.slots.find((slot) => slot.role === 'title');
    const copy = body(pattern);
    return (title?.fontSize ?? 1) / Math.max(1, ...copy.map((slot) => slot.fontSize));
  };
  const columns = (pattern: T) =>
    new Set(
      body(pattern).map((slot) =>
        slot.box ? Math.round(slot.box.x / Math.max(1, slot.box.cx)) : 0,
      ),
    ).size;
  const result = patternIds.map((id, index) => {
    const base = full.find((pattern) => pattern.patternId === id);
    if (!base || index === 0 || coverIds.has(id) || notes.get(id)?.special) return id;
    const requirements = new Set(notes.get(id)?.requiredContent ?? []);
    const candidates = full.filter((candidate) => {
      if (
        coverIds.has(candidate.patternId) ||
        notes.get(candidate.patternId)?.skip ||
        notes.get(candidate.patternId)?.special
      )
        return false;
      if (signature(candidate) !== signature(base)) return false;
      if (
        !semanticSlotMap(
          { ...base, slots: writerSlots(base) },
          { ...candidate, slots: writerSlots(candidate) },
          notes.get(id),
          notes.get(candidate.patternId),
        )
      )
        return false;
      if (
        FRAMING_KINDS.has(notes.get(candidate.patternId)?.kind ?? 'other') !==
        FRAMING_KINDS.has(notes.get(id)?.kind ?? 'other')
      )
        return false;
      if (
        (notes.get(candidate.patternId)?.requiredContent ?? []).some(
          (requirement) => !requirements.has(requirement),
        )
      )
        return false;
      const need = needs[index];
      if (need && !fitsDataLayout(candidate, need)) return false;
      return body(candidate).every(
        (slot, position) =>
          slot.maxChars >= (body(base)[position]?.maxChars ?? 0) * MIN_CAPACITY_SHARE,
      );
    });
    const distinct = [
      ...new Map(
        candidates.map((candidate) => [compositionStructure(candidate), candidate]),
      ).values(),
    ].filter((candidate) => compositionStructure(candidate) !== compositionStructure(base));
    // Analytical: parallel comparisons and peer groups. Editorial: strongest claim hierarchy.
    const analytical = [...distinct].sort(
      (a, b) =>
        columns(b) - columns(a) ||
        hierarchy(a) - hierarchy(b) ||
        a.patternId.localeCompare(b.patternId),
    )[0];
    const editorial = [...distinct]
      .filter(
        (candidate) =>
          !analytical || compositionStructure(candidate) !== compositionStructure(analytical),
      )
      .sort(
        (a, b) =>
          hierarchy(b) - hierarchy(a) ||
          columns(a) - columns(b) ||
          a.patternId.localeCompare(b.patternId),
      )[0];
    return (variant === 'dense' ? analytical : editorial)?.patternId ?? id;
  });
  return result;
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
  context: CopyContext = {},
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
  const defects = copyDefects(slide, pattern, context);
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
  approvedSlide: deckOutlineSchema.shape.slides.element.optional(),
  requiredClaims: z.array(requiredSlideClaimSchema).default([]),
  composition: compositionSchema,
  previous: composedSlideSchema,
  corrections: z.array(z.object({ slotId: z.string(), message: z.string() })),
});
export const repairedSlideSchema = z.object({ index: z.number(), slide: composedSlideSchema });

export function createRepairWorkflow(deps: GenerationDependencies) {
  const accepted = new Map<number, unknown>();
  const start = createStep({
    id: 'repair-input',
    inputSchema: z.array(repairTaskSchema),
    outputSchema: z.array(repairTaskSchema),
    execute: async ({ inputData }) => {
      if (deps.deckRepairInstructions === undefined) return inputData;
      deps.signal.throwIfAborted();
      accepted.clear();
      const jobs = inputData
        .map((task) => ({ task, ...rewriteInput(deps, task) }))
        .filter((job) => job.slots.length > 0);
      if (!jobs.length) return inputData;
      const schema = templateDeckRepairsSchema.extend({
        slides: z.strictObject(
          Object.fromEntries(jobs.map((job) => [String(job.task.index), job.schema])),
        ),
      });
      const result = await deps.provider.generate(
        'rewriter',
        deps.deckRepairInstructions,
        {
          brief: jobs[0]?.task.brief,
          variant: deps.variant ?? 'balanced',
          variantCopyMode: deps.variantCopyMode ?? 'independent',
          slides: jobs.map(({ task, input }) => {
            const { brief: _brief, ...slide } = input;
            return { ...slide, index: task.index };
          }),
        },
        schema,
        deps.signal,
      );
      deps.signal.throwIfAborted();
      for (const job of jobs) accepted.set(job.task.index, result.slides[String(job.task.index)]);
      return inputData;
    },
  });
  const repair = createStep({
    id: 'repair-template-slide',
    inputSchema: repairTaskSchema,
    outputSchema: repairedSlideSchema,
    execute: async ({ inputData }) => {
      let slide: ComposedSlide;
      try {
        slide = await rewriteSlide(deps, inputData, accepted.get(inputData.index));
      } catch (error) {
        // One slide out of rewrites must not take the other slides' repairs down with it: it
        // keeps its copy, and the audit reports what is still wrong.
        deps.signal.throwIfAborted();
        if (!(error instanceof Error && error.message.startsWith('Semantic attempt limit')))
          throw error;
        await deps.onWarning?.(`Repair slide ${inputData.index + 1}: ${error.message}`);
        slide = inputData.previous;
      }
      // Same guarantee as the write step: an uncured slide is reported through onWarning, not
      // fatal, so the run keeps all three variants.
      for (const problem of blockingProblems(slide, inputData.composition, {
        ...(deps.notes?.find((entry) => entry.patternId === inputData.composition.patternId)
          ? {
              note: deps.notes.find((entry) => entry.patternId === inputData.composition.patternId),
            }
          : {}),
        brief: inputData.brief,
        ...(deps.today ? { today: deps.today } : {}),
      }))
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
export function bestFittingAlternative(
  slot: {
    role: string;
    sample: string;
    maxChars: number;
    maxLines: number;
    prompt?: boolean;
    fontSize?: number;
    textWidthPt?: number;
    capacity?: Slot['capacity'];
    semanticRole?: string;
  },
  alternatives: readonly string[],
  variant?: DeckVariant,
): string | undefined {
  const fitting = alternatives.filter(
    (t) =>
      t.length <= fitChars(slot) &&
      t.length <= slot.maxChars &&
      t.split('\n').length <= slot.maxLines &&
      (slot.role !== 'title' || t.trim()),
  );
  // An alternative that keeps a word wider than the box is the one the engine would tear: the
  // others come first, and it is taken only when every one of them would be.
  const whole = fitting.filter((t) => !tearsAWord(t, slot));
  const candidates = whole.length ? whole : fitting;
  if (!variant) return candidates.sort((a, b) => b.length - a.length)[0];
  const range = targetRange(slot, variant);
  const target = (range.targetMinChars + range.targetMaxChars) / 2;
  const distance = (text: string) =>
    text.length < range.targetMinChars
      ? range.targetMinChars - text.length
      : text.length > range.targetMaxChars
        ? text.length - range.targetMaxChars
        : 0;
  return candidates.sort(
    (a, b) =>
      distance(a) - distance(b) || Math.abs(a.length - target) - Math.abs(b.length - target),
  )[0];
}

function rewriteInput(deps: GenerationDependencies, task: z.infer<typeof repairTaskSchema>) {
  // Numbering and dates are written by code: a critic that asks to change them (a model sure of
  // another year) is not followed, and the slot keeps what code wrote.
  const owned = new Set([
    ...numberedSlots(task.composition).keys(),
    ...datedSlots(task.composition).keys(),
  ]);
  const slots = task.composition.slots.filter(
    (s) =>
      !owned.has(s.slotId) &&
      s.slotId !== task.previous.visual?.slotId &&
      !mirroredSlots(task.composition).has(s.slotId) &&
      (task.corrections.some((c) => c.slotId === s.slotId) ||
        (deps.deckRepairInstructions !== undefined && task.corrections.length > 0)),
  );
  const schema = slotRewriteChoicesSchema.extend({
    rewrites: z.object(
      Object.fromEntries(
        slots.map((s) => [
          s.slotId,
          z
            .array(
              // Evaluate choices independently below: one oversized candidate must not
              // discard valid alternatives for every slide in the same batch.
              (s.role === 'title' ? z.string().min(1) : z.string()).describe(
                `At most ${Math.min(s.maxChars, fitChars(s))} characters, including spaces.`,
              ),
            )
            .length(3),
        ]),
      ),
    ),
  });
  const semantics = compositionSemantics(
    task.composition,
    deps.notes?.find((note) => note.patternId === task.composition.patternId),
  );
  const input = {
    // The slide's place: the rewrite budget is counted per slide, and slot ids repeat across them.
    index: task.index,
    brief: task.brief,
    variant: deps.variant ?? 'balanced',
    variantCopyMode: deps.variantCopyMode ?? 'independent',
    requiredClaims: task.requiredClaims,
    groups: semantics.groups,
    ...(task.purpose ? { purpose: task.purpose } : {}),
    ...(task.approvedSlide ? { approvedSlide: task.approvedSlide } : {}),
    // The filled slots of the same slide, so a new point does not repeat them.
    otherSlots: task.previous.texts
      .filter((t) => t.text.trim() && !slots.some((s) => s.slotId === t.slotId))
      .map((t) => ({ ...t, ...semantics.slots.find((slot) => slot.slotId === t.slotId) })),
    slots: slots.map((s) => {
      const policySlot = { ...s, ...semantics.slots.find((slot) => slot.slotId === s.slotId) };
      return {
        slotId: s.slotId,
        role: s.role,
        sample: s.sample,
        ...(s.prompt ? { prompt: true } : {}),
        maxChars: s.maxChars,
        fitChars: fitChars(s),
        ...targetRange(policySlot, deps.variant ?? 'balanced'),
        ...semantics.slots.find((slot) => slot.slotId === s.slotId),
        ...(minChars(policySlot, deps.variant)
          ? { minChars: minChars(policySlot, deps.variant) }
          : {}),
        maxLines: s.maxLines,
        text: task.previous.texts.find((t) => t.slotId === s.slotId)?.text,
        correction: task.corrections
          .filter((c) => c.slotId === s.slotId)
          .map((c) => c.message)
          .join('; '),
      };
    }),
  };
  return { slots, schema, input, semantics };
}

async function rewriteSlide(
  deps: GenerationDependencies,
  task: z.infer<typeof repairTaskSchema>,
  accepted?: unknown,
): Promise<ComposedSlide> {
  const { slots, schema, input, semantics } = rewriteInput(deps, task);
  if (!slots.length) return task.previous;
  deps.signal.throwIfAborted();
  if (accepted === undefined && deps.attemptBudget && !deps.attemptBudget.tryTake()) {
    await deps.onWarning?.(`Repair budget exhausted for slide ${task.index + 1}.`);
    return task.previous;
  }
  // One semantic attempt; transport/schema retries belong to the provider and the same budget.
  const result =
    accepted !== undefined
      ? schema.parse(accepted)
      : await deps.provider.generate(
          'rewriter',
          deps.repairInstructions ?? deps.writerInstructions,
          input,
          schema,
          deps.signal,
        );
  const slide = { ...task.previous, texts: task.previous.texts.map((t) => ({ ...t })) };
  if (deps.deckRepairInstructions !== undefined) {
    const revised = selectSlideRepair({
      previous: slide,
      slots: slots.map((slot) => ({
        ...slot,
        ...semantics.slots.find((entry) => entry.slotId === slot.slotId),
      })),
      rewrites: result.rewrites,
      requiredClaims: task.requiredClaims,
      bestFittingAlternative: (slot, alternatives) =>
        bestFittingAlternative(slot, alternatives, deps.variant ?? 'balanced'),
    });
    return keepStatedFacts(revised, task.composition, task.brief);
  }
  for (const slot of slots) {
    const before = slide.texts.map((text) => text.text).join('\n');
    const alternatives = (result.rewrites[slot.slotId] ?? []).filter((candidate) =>
      retainsClaimDetails(
        before,
        slide.texts.map((text) => (text.slotId === slot.slotId ? candidate : text.text)).join('\n'),
        task.requiredClaims,
      ),
    );
    const policy = { ...slot, ...semantics.slots.find((entry) => entry.slotId === slot.slotId) };
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    let text = bestFittingAlternative(policy, alternatives, deps.variant ?? 'balanced');
    // Copy that overflows its box fails the whole variant at export. When every shorter wording
    // loses a detail of a claim, the one that fits is taken and the report says what may be gone.
    if (text === undefined && (binding?.text.length ?? 0) > slot.maxChars) {
      text = bestFittingAlternative(
        policy,
        result.rewrites[slot.slotId] ?? [],
        deps.variant ?? 'balanced',
      );
      if (text !== undefined)
        await deps.onWarning?.(
          `Slide ${task.index + 1}, slot ${slot.slotId}: shortened to fit its box; check that ` +
            'every figure of the slide is still there.',
        );
    }
    // No alternative fits the box. The slot keeps its previous copy (or stays empty when it was
    // an unfillable card): a flagged slide costs one finding, a failed variant would cost the
    // whole deck, and all three variants are mandatory.
    if (text === undefined) continue;
    if (binding) binding.text = text;
  }
  // A rewrite of a speaker or contact field keeps only what the brief states.
  return keepStatedFacts(slide, task.composition, task.brief);
}
