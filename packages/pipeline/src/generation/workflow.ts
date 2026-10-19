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
  templateSlotCopySchema,
  type ComposedSlide,
  type CompositionNote,
  type DeckOutline,
  type GenerationProfile,
  type SlotVisual,
} from '@lct/contracts';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { tearsAWord } from './fit.js';
import { isFigureSample } from './samples.js';
import { diversifyPlan } from './variety.js';
import type { TextProvider } from './provider.js';
import { declaredQrSlots, safeQrPlan, sourceQrUrls } from './qr-assets.js';
import { dependencyKey } from './checkpoints.js';
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
  /** One canonical writer task per slide; variants adapt its accepted copy. */
  sharedContent?: SharedContent;
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
});
export const writtenSchema = z.object({
  index: z.number(),
  title: z.string(),
  /** The claim the plan gave the slide: the deck-wide checks and the repair read it. */
  purpose: z.string().default(''),
  approvedSlide: deckOutlineSchema.shape.slides.element.optional(),
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
}): number {
  const sampleLen = slot.sample.trim().length;
  // A layout prompt names the box but was never sized to it: the box itself is the measure.
  if (sampleLen === 0 || slot.prompt) return slot.maxChars;
  const scaled = Math.ceil(sampleLen * 1.25);
  const label = slot.maxLines === 1 ? Math.floor(slot.maxChars / 3) : 0;
  const floor = Math.min(slot.maxChars, slot.role === 'title' ? 36 : Math.max(8, label));
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
  },
  variant: DeckVariant = 'balanced',
): number {
  if (slot.role !== 'body') return 0;
  // A paragraph break and a line break inside one (a vertical tab in the pptx) both start a line.
  const sampleLines = slot.sample.split(/[\n\v]/).filter((line) => line.trim()).length;
  const block = slot.prompt ? slot.maxLines >= 4 : sampleLines >= 2 && slot.maxLines >= 3;
  return block ? Math.floor(fitChars(slot) * FILL_FLOOR[variant]) : 0;
}

/** What the writer and the rewriter are told when a block is too thin for its box. */
export function thinMessage(length: number, least: number, room: number): string {
  return (
    `The text has ${length} characters in a box made for about ${room}: the slide looks empty. ` +
    `Write ${least} to ${room} characters: add lines that explain, prove or illustrate this ` +
    'point — a cause, a consequence, an example, a step, a criterion — from the brief or common ' +
    'knowledge of the subject, one point per line. Add no figures the brief does not state.'
  );
}

export function slotBriefs(
  slots: GenerationProfile['compositions'][number]['slots'],
  variant?: DeckVariant,
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
    return {
      slotId: slot.slotId,
      role: slot.role,
      sample: slot.sample,
      ...(slot.prompt ? { prompt: true } : {}),
      maxChars: slot.maxChars,
      maxLines: slot.maxLines,
      fontSize: slot.fontSize,
      fitChars: fitChars(slot),
      ...(variant && minChars(slot, variant) ? { minChars: minChars(slot, variant) } : {}),
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
): T {
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
export function withCardHeadingProfile(profile: GenerationProfile): GenerationProfile {
  return { ...profile, compositions: profile.compositions.map(withCardHeadings) };
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
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    ...(note ? { kind: note.kind, items: note.items, useFor: note.useFor } : {}),
    ...(note?.special ? { special: true } : {}),
    ...(note ? { requiredContent: note.requiredContent } : {}),
    imageCount: pattern.imageCount,
    /** Places this composition has for a generated picture. */
    imageSlots: (pattern.imageSlots ?? []).filter(
      (s) => !declaredQrSlots(pattern, note).includes(s.slotId),
    ).length,
    ...(note?.qrSlotIds?.length ? { qrSlotIds: declaredQrSlots(pattern, note) } : {}),
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
  const compositions = profile.compositions.map(withCardHeadings);
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
      writerSlots(pattern).every((slot) => slot.maxChars >= 12),
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

function boundedSlideSchema(pattern: GenerationProfile['compositions'][number]) {
  const slots = visualSlots(pattern);
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
          z.string(),
        ]),
      ),
    ),
    speakerNotes: z.string(),
    visual,
  });
}

/** A figure as a brief writes it: "1 800" with a (thin, no-break) space between thousands is one number. */
const FIGURE = /\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

function figuresOf(text: string): number[] {
  return (text.match(FIGURE) ?? []).map((n) =>
    Number(n.replace(/[ \u00a0\u202f]/g, '').replace(',', '.')),
  );
}

/** Reject unsupported literals, units and source quotations before deterministic placement. */
function groundedNative(
  visual: Extract<SlotVisual, { kind: 'native' }>,
  brief: string,
): SlotVisual | null {
  const norm = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const contains = (text: string, value: string) => !value || norm(text).includes(norm(value));
  const sources =
    visual.block.kind === 'kpi'
      ? visual.block.items.flatMap((item) => item.sources)
      : visual.block.sources;
  if (sources.some((source) => !contains(brief, source.quote))) return null;
  const quotes = sources.map((source) => source.quote).join('\n');
  const measured = (
    value: { state: string; literal?: string; value?: number },
    unit: string,
    evidence: string,
  ) => {
    if (value.state === 'missing') return value.literal === undefined && value.value === undefined;
    if (value.literal === undefined || value.value === undefined) return false;
    const parsed = Number(value.literal.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
    return (
      Number.isFinite(parsed) &&
      parsed === value.value &&
      contains(evidence, value.literal) &&
      contains(evidence, unit)
    );
  };
  const block = visual.block;
  if (block.kind === 'kpi') {
    if (
      block.items.some((item) => {
        const evidence = item.sources.map((source) => source.quote).join('\n');
        return (
          !measured(item.value, item.unit, evidence) ||
          (item.periodKnown && !contains(evidence, item.period)) ||
          (!!item.caveat && !contains(brief, item.caveat)) ||
          (!!item.comparison &&
            (!measured(item.comparison.base, item.comparison.baseUnit, evidence) ||
              !contains(evidence, item.comparison.basePeriod)))
        );
      })
    )
      return null;
  } else if (block.kind === 'chart') {
    if (
      block.series.some(
        (series) =>
          series.values.length !== block.categories.length ||
          series.values.some((value) => !measured(value, series.unit, quotes)),
      ) ||
      block.categories.some((category) => !contains(quotes, category.label)) ||
      (!!block.caveat && !contains(brief, block.caveat))
    )
      return null;
  } else if (
    block.rows.some(
      (row) =>
        row.cells.length !== block.columns.length ||
        row.cells.some((cell) => !cell.missing && !contains(quotes, cell.text)),
    ) ||
    !contains(brief, block.notes) ||
    (!!block.caveat && !contains(brief, block.caveat))
  )
    return null;
  return visual;
}

/**
 * A visual only when every figure in it is in the brief: a chart is where an invented number
 * would do most harm, so a visual that cannot be traced to the source is dropped and the slot
 * keeps its text. A chart that compares nothing — one category, or the same value everywhere —
 * is a made-up score rather than data, and is dropped too.
 */
export function groundedVisual(
  visual: SlotVisual | null | undefined,
  brief: string,
): SlotVisual | null {
  if (!visual) return null;
  if (visual.kind === 'native') return groundedNative(visual, brief);
  const known = new Set(figuresOf(brief));
  const figures =
    visual.kind === 'chart'
      ? visual.series.flatMap((series) => series.values)
      : visual.rows.flat().flatMap(figuresOf);
  if (
    visual.kind === 'chart' &&
    (visual.categories.length < 2 ||
      visual.series.some((s) => s.values.length !== visual.categories.length) ||
      new Set(figures).size < 2)
  )
    return null;
  if (visual.kind === 'table' && visual.rows.some((row) => row.length !== visual.headers.length))
    return null;
  return figures.length > 0 && figures.every((n) => known.has(n)) ? visual : null;
}

function writingComposition(
  pattern: GenerationProfile['compositions'][number],
  variant: DeckVariant,
) {
  return {
    patternId: pattern.patternId,
    name: pattern.name,
    imageCount: pattern.imageCount,
    slots: slotBriefs(writerSlots(pattern), variant),
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
  const textOf = (slotId: string) =>
    slide.texts.find((t) => t.slotId === slotId)?.text.trim() ?? '';
  for (const slot of slots) {
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
    else if (context.variant && text.length < minChars(slot, context.variant))
      defects.set(
        slot.slotId,
        thinMessage(text.length, minChars(slot, context.variant), fitChars(slot)),
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
  const plan = createStep({
    id: 'plan-compositions',
    inputSchema,
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
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
              imagesAvailable: deps.imagesAvailable === true,
              allowedQrUrls: sourceQrUrls(qrSourceBrief),
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
        const source = [
          inputData.brief,
          ...(outline?.slides ?? []).flatMap((slide) => [slide.title, ...slide.points]),
        ].join('\n');
        const evidenceCorrections = (result: z.infer<typeof compositionPlanSchema>) => {
          const missing = missingRequiredContent(result, notes, source);
          return missing.length ? { missingRequiredContent: missing } : undefined;
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
          ...varietyCorrections(result),
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
        });
        result = { ...result, slides: varied.slides };
        if (varied.repeated.length) {
          await deps.onWarning?.(
            `Слайды ${varied.repeated.map((r) => r.index + 1).join(', ')} остались на макете, ` +
              'который в колоде уже повторяется: в шаблоне нет другого макета с тем же числом ' +
              'пунктов. Разнообразие ограничено шаблоном.',
          );
        }
        // Still a layout for a speaker, a contact or a screenshot the source does not have: the
        // slide moves to one that needs none, instead of the deck failing.
        result = withoutMissingContent(
          result,
          missingRequiredContent(result, notes, source),
          full,
          notes,
          deps.imagesAvailable === true,
        );
        return outline ? keepOutline(result, outline) : result;
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
      const remapped = remapPlan(
        result.slides.map((slide) => slide.patternId),
        full,
        catalog,
        variant,
        covers,
        notes,
        deps.layoutRemapPolicy ?? 'density',
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
        if (deps.sharedContent && canonicalComposition) {
          // A deterministic one-to-one mapping cannot drop a mandatory fact. A poorer template
          // keeps its original composition instead of discarding or inventing content blocks.
          const signature = (p: GenerationProfile['compositions'][number]) =>
            [true, false]
              .map((title) => writerSlots(p).filter((s) => (s.role === 'title') === title).length)
              .join(':');
          if (signature(composition) !== signature(canonicalComposition))
            composition = canonicalComposition;
        }
        return {
          ...slide,
          patternId: composition.patternId,
          narrative: result.slides.map((s) => s.purpose),
          ...(outline?.slides[index]
            ? { slideTitle: outline.slides[index].title, approvedSlide: outline.slides[index] }
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
          ...(deps.sharedContent && canonicalComposition ? { canonicalComposition } : {}),
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
  const write = createStep({
    id: 'write-template-slide',
    inputSchema: taskSchema,
    outputSchema: writtenSchema,
    execute: async ({ inputData }) => {
      let slide: ComposedSlide | undefined;
      // The deck title goes under its own name: as `title` the writer took it for the title
      // of the slide and put it on slide after slide.
      const { title: deckTitle, canonicalComposition, ...task } = inputData;
      const base = canonicalComposition ?? inputData.composition;
      const writeInput = {
        ...task,
        deckTitle,
        variant: deps.sharedContent ? 'balanced' : (deps.variant ?? 'balanced'),
        composition: writingComposition(
          base,
          deps.sharedContent ? 'balanced' : (deps.variant ?? 'balanced'),
        ),
        visualSlots: visualSlots(base),
      };
      const compute = () =>
        deps.provider.generate(
          'writer',
          deps.writerInstructions,
          writeInput,
          boundedSlideSchema(base),
          deps.signal,
        );
      let raw = deps.sharedContent
        ? await deps.sharedContent.once(
            { instructions: deps.writerInstructions, input: writeInput },
            compute,
          )
        : await compute();
      if (base.patternId !== inputData.composition.patternId) {
        const map = new Map<string, string>();
        for (const title of [true, false]) {
          const source = writerSlots(base).filter((s) => (s.role === 'title') === title);
          const target = writerSlots(inputData.composition).filter(
            (s) => (s.role === 'title') === title,
          );
          source.forEach((slot, index) => {
            if (target[index]) map.set(slot.slotId, target[index].slotId);
          });
        }
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
      let visual = groundedVisual(raw.visual as SlotVisual | null, inputData.brief);
      if (visual?.kind === 'native') visual = { ...visual, variant: deps.variant ?? 'balanced' };
      const texts = raw.textsBySlot as Record<string, string | undefined>;
      const context: CopyContext = {
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
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!validateBindings(slide, inputData.composition, context).length) break;
        const current: ComposedSlide = slide;
        slide = await rewriteSlide(deps, {
          index: inputData.index,
          brief: inputData.brief,
          purpose: inputData.purpose,
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
): string[] {
  if (policy === 'conceptual') return conceptualLayouts(patternIds, full, variant, covers, notes);
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
    const compatible = pool.filter(
      (p) => !addsRequirements(p.patternId, id) && framing(p.patternId) === framing(id),
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
      for (const problem of blockingProblems(slide, inputData.composition, {
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
  },
  alternatives: readonly string[],
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
  return (whole.length ? whole : fitting).sort((a, b) => b.length - a.length)[0];
}

/** How many times the rewriter may be asked to fix one slide before the deck fails. */
const MAX_REWRITE_ATTEMPTS = 5;

async function rewriteSlide(
  deps: GenerationDependencies,
  task: z.infer<typeof repairTaskSchema>,
): Promise<ComposedSlide> {
  // Numbering and dates are written by code: a critic that asks to change them (a model sure of
  // another year) is not followed, and the slot keeps what code wrote.
  const owned = new Set([
    ...numberedSlots(task.composition).keys(),
    ...datedSlots(task.composition).keys(),
  ]);
  const slots = task.composition.slots.filter(
    (s) => !owned.has(s.slotId) && task.corrections.some((c) => c.slotId === s.slotId),
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
    ...(task.approvedSlide ? { approvedSlide: task.approvedSlide } : {}),
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
      ...(minChars(s, deps.variant) ? { minChars: minChars(s, deps.variant) } : {}),
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
      // Transport retries belong to the provider. Never multiply auth/quota/budget
      // failures by another semantic retry loop.
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
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
  // A rewrite of a speaker or contact field keeps only what the brief states.
  return keepStatedFacts(slide, task.composition, task.brief);
}
