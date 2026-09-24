import { z } from 'zod';

/**
 * DeckPlan — what the deck says, decided once and reused by every layout variant.
 *
 * Nothing here describes appearance. No coordinate, no colour, no typeface: the same plan has to
 * survive being laid out three different ways on a template nobody has seen, and any geometry
 * that leaked in would quietly become a constraint on the layout that produced it.
 *
 * The other rule this schema enforces is provenance. Anything that carries a number — a table, a
 * chart, a headline figure — must name where the number came from, because the audit asks whether
 * every fact on a slide is in the source material and cannot answer that from the slide alone.
 */

/** Where a claim comes from in the content the user supplied. */
export const sourceRefSchema = z.object({
  itemId: z.string().min(1).describe('Identifier of the content pack item this came from.'),
  quote: z
    .string()
    .min(1)
    .describe('The passage the claim rests on, copied verbatim so it can be checked.'),
});

/** What a slide is for. The layout picks a pattern that can serve the intent. */
export const slideIntentSchema = z.enum([
  'title',
  'agenda',
  'section',
  'statement',
  'bullets',
  'two-column',
  'kpi',
  'table',
  'chart',
  'quote',
  'image',
  'closing',
]);

export const bulletsBlockSchema = z.object({
  kind: z.literal('bullets'),
  items: z.array(z.string().min(1)).min(1).describe('One line each, in order.'),
});

export const paragraphBlockSchema = z.object({
  kind: z.literal('paragraph'),
  text: z.string().min(1),
});

export const quoteBlockSchema = z.object({
  kind: z.literal('quote'),
  text: z.string().min(1),
  attribution: z.string().describe('Who said it. Empty when the source is the deck itself.'),
});

export const tableBlockSchema = z.object({
  kind: z.literal('table'),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1).describe('Every row as wide as the header.'),
  sources: z.array(sourceRefSchema).min(1).describe('Where the figures come from.'),
});

export const chartSeriesSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.number()).min(1).describe('As long as the category list.'),
});

export const chartBlockSchema = z.object({
  kind: z.literal('chart'),
  chartType: z.enum(['bar', 'column', 'line', 'pie', 'area']),
  categories: z.array(z.string()).min(1),
  series: z.array(chartSeriesSchema).min(1),
  xTitle: z.string().describe('Axis label. Empty only when the categories speak for themselves.'),
  yTitle: z.string().describe('Axis label, including the unit.'),
  sources: z.array(sourceRefSchema).min(1).describe('Where the figures come from.'),
});

export const kpiItemSchema = z.object({
  value: z.string().min(1).describe('The figure as it should read, including its unit.'),
  caption: z.string().min(1).describe('What the figure measures.'),
  sources: z.array(sourceRefSchema).min(1).describe('Where the figure comes from.'),
});

export const kpiBlockSchema = z.object({
  kind: z.literal('kpi'),
  items: z.array(kpiItemSchema).min(1).max(4),
});

/**
 * A request for a picture, not a picture.
 *
 * Which image satisfies it — an asset from the template, a stock icon, a generated one — is the
 * visuals layer's decision, and it depends on what the template carries.
 */
export const imageBlockSchema = z.object({
  kind: z.literal('image'),
  role: z.enum(['photo', 'icon', 'mockup', 'decor']),
  query: z.string().min(1).describe('What the picture should show, in words.'),
});

export const planBlockSchema = z.discriminatedUnion('kind', [
  bulletsBlockSchema,
  paragraphBlockSchema,
  quoteBlockSchema,
  tableBlockSchema,
  chartBlockSchema,
  kpiBlockSchema,
  imageBlockSchema,
]);

/** One slide, as intent and content. */
export const plannedSlideSchema = z.object({
  slideId: z
    .string()
    .min(1)
    .describe('Stable across layout variants, so three renderings of a slide can be compared.'),
  intent: slideIntentSchema,
  headline: z.string().min(1).describe('States a conclusion rather than naming a topic.'),
  subhead: z.string().describe('Empty when the headline stands alone.'),
  blocks: z.array(planBlockSchema).describe('Body of the slide, in reading order.'),
  speakerNotes: z.string().describe('Not rendered on the slide.'),
  sources: z
    .array(sourceRefSchema)
    .describe('What the slide as a whole rests on, beyond any block-level references.'),
});

export const deckPlanSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  planId: z.string().min(1).describe('Identifies this plan across the three layout variants.'),
  briefId: z.string().min(1).describe('The brief this plan was built from.'),
  title: z.string().min(1),
  language: z.string().min(2).describe('BCP 47 tag. One deck, one language.'),
  slides: z.array(plannedSlideSchema).min(1),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type SlideIntent = z.infer<typeof slideIntentSchema>;
export type PlanBlock = z.infer<typeof planBlockSchema>;
export type PlannedSlide = z.infer<typeof plannedSlideSchema>;
export type DeckPlan = z.infer<typeof deckPlanSchema>;
