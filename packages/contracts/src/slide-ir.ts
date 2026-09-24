import { z } from 'zod';
import { colorRoleSchema } from './design-system.js';
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
 *
 * The editor saves its result as SlideIR too, so the look it lets a user change lives here as
 * optional fields: rotation, opacity, a lock, the style of a shape, text alignment, a slide
 * background. Absent means what it meant before those fields existed, which keeps every payload
 * written without them valid. Colours are palette roles throughout, never literal values.
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

/**
 * What every element can carry besides its box. All optional: the layout states none of it, the
 * editor writes it when a user asks.
 */
const elementLook = {
  rotation: z
    .number()
    .min(0)
    .lt(360)
    .optional()
    .describe('Clockwise, in degrees, about the centre of the box. Absent means 0.'),
  opacity: z.number().min(0).max(1).optional().describe('From 0 to 1. Absent means opaque.'),
  locked: z
    .boolean()
    .optional()
    .describe(
      'True keeps the editor from selecting or moving the element by accident, as template ' +
        'backgrounds usually are. Absent means false.',
    ),
};

/** Where the lines of a text element sit when they are shorter than its box. */
export const verticalAlignSchema = z.enum(['top', 'middle', 'bottom']);

export const textElementSchema = z.object({
  kind: z.literal('text'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
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
  verticalAlign: verticalAlignSchema
    .optional()
    .describe('Absent when the element inherits it, which reads as top.'),
});

/** How a picture meets its box. */
export const imageFitSchema = z.enum(['contain', 'cover']);

export const imageElementSchema = z.object({
  kind: z.literal('image'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
  sourceShapeId: z.number().int().nullable(),
  mediaPart: z
    .string()
    .min(1)
    .describe('Part name inside the template, or a path under the run directory.'),
  fit: imageFitSchema.describe('Never stretch: the audit looks for distortion.'),
});

export const tableElementSchema = z.object({
  kind: z.literal('table'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
  sourceShapeId: z.number().int().nullable(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
});

export const chartTypeSchema = z.enum(['bar', 'column', 'line', 'pie', 'area']);

export const chartElementSchema = z.object({
  kind: z.literal('chart'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
  sourceShapeId: z.number().int().nullable(),
  chartType: chartTypeSchema,
  categories: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string().min(1), values: z.array(z.number()).min(1) })).min(1),
  xTitle: z.string(),
  yTitle: z.string(),
});

/** Geometry of a decoration, drawn inside its box. An arrow is a `line` with an arrow tail. */
export const decorShapeSchema = z.enum([
  'rect',
  'round-rect',
  'ellipse',
  'triangle',
  'diamond',
  'line',
]);

export const strokeDashSchema = z.enum(['solid', 'dash', 'dot']);

/** What ends a line. OOXML calls the start the head and the end the tail. */
export const lineEndSchema = z.enum(['none', 'arrow']);

/** The outline of a shape, or the whole of a line. */
export const elementStrokeSchema = z.object({
  color: colorRoleSchema.describe('A role, never a literal colour: the template supplies it.'),
  widthEmu: z.number().int().positive().describe('Line width in EMU.'),
  dash: strokeDashSchema,
  head: lineEndSchema.describe('Mark at the start of a line.'),
  tail: lineEndSchema.describe('Mark at the end of a line.'),
});

/**
 * A shape that holds no content of ours: a panel, a rule or a card from the template, or a shape
 * drawn in the editor.
 *
 * Template decoration may state nothing but its box. Then `shape`, `fill` and `stroke` are absent
 * and a renderer picks a palette role from the geometry. Anything the editor draws states all
 * three, so its look never depends on its size.
 */
export const decorElementSchema = z.object({
  kind: z.literal('decor'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
  sourceShapeId: z
    .number()
    .int()
    .nullable()
    .describe('Template shape this was placed from. Null when it was drawn in the editor.'),
  shape: decorShapeSchema
    .optional()
    .describe('Absent for template decoration of a geometry the parser did not name.'),
  fill: colorRoleSchema
    .nullable()
    .optional()
    .describe('Null for no fill. Absent when the template did not state one.'),
  stroke: elementStrokeSchema
    .nullable()
    .optional()
    .describe('Null for no outline. Absent when the template did not state one.'),
  cornerRadius: z
    .number()
    .min(0)
    .max(0.5)
    .optional()
    .describe('Corner radius of a round-rect as a share of the shorter side. Absent means 1/6.'),
  flipH: z
    .boolean()
    .optional()
    .describe('Mirrored horizontally. A line runs from the top left of its box unless flipped.'),
  flipV: z.boolean().optional().describe('Mirrored vertically.'),
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
  background: colorRoleSchema
    .nullable()
    .optional()
    .describe('Palette role the slide is filled with. Null or absent: the template background.'),
});

export type LayoutVariantName = z.infer<typeof layoutVariantNameSchema>;
export type ElementRole = z.infer<typeof elementRoleSchema>;
export type VerticalAlign = z.infer<typeof verticalAlignSchema>;
export type DecorShape = z.infer<typeof decorShapeSchema>;
export type StrokeDash = z.infer<typeof strokeDashSchema>;
export type LineEnd = z.infer<typeof lineEndSchema>;
export type ElementStroke = z.infer<typeof elementStrokeSchema>;
export type ImageFit = z.infer<typeof imageFitSchema>;
export type ChartType = z.infer<typeof chartTypeSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type SlideElementKind = SlideElement['kind'];
export type SlideIr = z.infer<typeof slideIrSchema>;
