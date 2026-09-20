import { z } from 'zod';
import { boxSchema, paragraphSchema } from './template-ir.js';

/**
 * SlideIR — one laid-out slide, in template units, ready to be written as native objects.
 *
 * This is the handover point between the deterministic side of the engine and everything that
 * looks at the result. Export writes it into a .pptx, render turns it into a PNG, the audit
 * measures it, and the frontend draws findings on top of it. All four have to be talking about
 * the same rectangle, so every element carries an `elementId` that is stable for a given slide
 * and variant, and an optional `sourceShapeId` pointing back at the template shape it came from.
 *
 * The layout layer never rewrites text to make it fit. When something overflows it says so here
 * and leaves the copy alone; shortening it is a decision for an agent on the TypeScript side,
 * which is the only place allowed to call a model.
 */

/** Which of the three renderings of a plan this slide belongs to. */
export const layoutVariantNameSchema = z.enum(['dense', 'balanced', 'airy']);

/** What an element is for, which is what lets the audit judge it. */
export const elementRoleSchema = z.enum([
  'title',
  'subtitle',
  'body',
  'bullet-list',
  'kpi-value',
  'kpi-caption',
  'quote',
  'table',
  'chart',
  'image',
  'logo',
  'footer',
  'page-number',
  'decoration',
]);

export const textElementSchema = z.object({
  kind: z.literal('text'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  sourceShapeId: z
    .number()
    .int()
    .nullable()
    .describe('Template shape this was placed from, when it came from one.'),
  paragraphs: z.array(paragraphSchema).min(1),
  overflow: z
    .object({
      lines: z.number().int().nonnegative().describe('Lines that do not fit.'),
      emu: z.number().int().nonnegative().describe('How far past the box the text runs.'),
    })
    .nullable()
    .describe('Null when the text fits. Set instead of truncating it.'),
});

export const imageElementSchema = z.object({
  kind: z.literal('image'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  sourceShapeId: z.number().int().nullable(),
  mediaPart: z
    .string()
    .min(1)
    .describe('Part name inside the template, or a path under the run directory.'),
  fit: z.enum(['contain', 'cover']).describe('Never stretch: the audit looks for distortion.'),
});

export const tableElementSchema = z.object({
  kind: z.literal('table'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  sourceShapeId: z.number().int().nullable(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
});

export const chartElementSchema = z.object({
  kind: z.literal('chart'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  sourceShapeId: z.number().int().nullable(),
  chartType: z.enum(['bar', 'column', 'line', 'pie', 'area']),
  categories: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string().min(1), values: z.array(z.number()).min(1) })).min(1),
  xTitle: z.string(),
  yTitle: z.string(),
});

/** A shape carried over from the template that holds no content of ours. */
export const decorElementSchema = z.object({
  kind: z.literal('decor'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  sourceShapeId: z.number().int().describe('Decoration always comes from the template.'),
});

export const slideElementSchema = z.discriminatedUnion('kind', [
  textElementSchema,
  imageElementSchema,
  tableElementSchema,
  chartElementSchema,
  decorElementSchema,
]);

export const slideIrSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  slideId: z.string().min(1).describe('Matches the planned slide, across all three variants.'),
  variant: layoutVariantNameSchema,
  index: z.number().int().nonnegative().describe('Position in the deck, from zero.'),
  patternId: z
    .string()
    .min(1)
    .describe('Pattern from the template profile this slide was built on.'),
  slideCx: z.number().int().positive().describe('Slide width in EMU, from the template.'),
  slideCy: z.number().int().positive().describe('Slide height in EMU, from the template.'),
  elements: z.array(slideElementSchema).describe('In paint order, lowest first.'),
});

export type LayoutVariantName = z.infer<typeof layoutVariantNameSchema>;
export type ElementRole = z.infer<typeof elementRoleSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type SlideIr = z.infer<typeof slideIrSchema>;
