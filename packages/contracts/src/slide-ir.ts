import { z } from 'zod';
import { colorValueSchema } from './design-system.js';
import { boxSchema, paragraphAlignSchema, paragraphSchema } from './template-ir.js';

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
 * background, the groups a user made. Absent means what it meant before those fields existed,
 * which keeps every payload written without them valid. Colours are palette roles unless a user
 * chose a hex value of their own, which the audit may flag as off-palette.
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
  groupIds: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe(
      'Groups the element belongs to, outermost first. Elements whose ids start with the same ' +
        'run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a ' +
        'group are consecutive in paint order. Absent: the element is in no group.',
    ),
  sourcePart: z
    .enum(['slide', 'layout', 'master'])
    .optional()
    .describe(
      'Which part the shape was read from. Master and layout graphics are already painted when ' +
        'a slide of that layout is cloned, so an export that keeps the source slide must not ' +
        'draw them again. Absent means the slide itself.',
    ),
};

/**
 * Space between the edge of a shape and its text, in EMU: `lIns`, `tIns`, `rIns` and `bIns` of
 * OOXML `a:bodyPr`.
 */
export const textInsetsSchema = z.object({
  l: z.number().int().nonnegative(),
  t: z.number().int().nonnegative(),
  r: z.number().int().nonnegative(),
  b: z.number().int().nonnegative(),
});

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
  textInsets: textInsetsSchema
    .optional()
    .describe('Space between the box and its text (`a:bodyPr` insets). Absent: none.'),
});

/** How a picture meets its box. */
export const imageFitSchema = z.enum(['contain', 'cover']);

/**
 * The part of a picture a user cropped it to, as shares of the source picture cut off each side:
 * `l` of its width from the left, `t` of its height from the top, and so on. It is `a:srcRect` of
 * OOXML divided by 100 000, so export writes it one to one. What is left of the picture fills the
 * box; the editor keeps that part as wide for its height as the box, so nothing is stretched.
 * `l + r` and `t + b` stay below 1, which the editor ensures.
 */
export const imageCropSchema = z.object({
  l: z.number().min(0).lt(1).describe('Share of the width cut off on the left.'),
  t: z.number().min(0).lt(1).describe('Share of the height cut off at the top.'),
  r: z.number().min(0).lt(1).describe('Share of the width cut off on the right.'),
  b: z.number().min(0).lt(1).describe('Share of the height cut off at the bottom.'),
});

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
  crop: imageCropSchema
    .optional()
    .describe(
      'The part of the picture that shows, filling the box. Absent: the whole picture, placed ' +
        'by `fit`.',
    ),
});

/**
 * The look of one table cell, as a user set it. Every key is optional: absent inherits from the
 * header or banded row the cell sits in, then from the type role of the table. It maps onto
 * OOXML one to one: `fill` is the `a:tcPr` fill, `color`, `bold`, `italic` and `underline` the
 * `a:rPr` of its runs, `align` the paragraph `algn`, `verticalAlign` the `anchor` of the cell.
 */
export const tableCellStyleSchema = z.object({
  fill: colorValueSchema
    .nullable()
    .optional()
    .describe('Background of the cell. Null for none, even in a header or banded row.'),
  color: colorValueSchema.optional().describe('Colour of the text. Absent: the type role.'),
  bold: z.boolean().optional().describe('Absent: bold in the header row, regular elsewhere.'),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  align: paragraphAlignSchema.optional().describe('Horizontal alignment. Absent means left.'),
  verticalAlign: verticalAlignSchema.optional().describe('Absent means top.'),
});

/** The rules drawn between and around the cells of a table. */
export const tableBordersSchema = z.object({
  color: colorValueSchema.describe('A palette role, or a hex value a user chose.'),
  widthEmu: z.number().int().positive().describe('Line width in EMU.'),
  horizontal: z.boolean().describe('A rule under every row, the last one included.'),
  vertical: z.boolean().describe('Rules between columns.'),
  outer: z.boolean().describe('A frame around the whole table.'),
});

/**
 * A table: the header row, then the body rows, every row as wide as the header.
 *
 * Geometry and look are optional and written by the editor. Column widths and row heights are
 * shares of the box rather than lengths, so a table resized as a whole keeps its proportions and
 * the box stays the one source of its size; export multiplies them out into `a:gridCol w` and
 * `a:tr h`. Per-row and per-column arrays run header first, the same order as `cellStyles`.
 */
export const tableElementSchema = z.object({
  kind: z.literal('table'),
  elementId: z.string().min(1),
  role: elementRoleSchema,
  box: boxSchema,
  ...elementLook,
  sourceShapeId: z.number().int().nullable(),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
  columnWidths: z
    .array(z.number().positive())
    .min(1)
    .optional()
    .describe(
      'Share of the box width each column takes, one per header, read relative to their sum. ' +
        'Absent: equal columns.',
    ),
  rowHeights: z
    .array(z.number().positive())
    .min(1)
    .optional()
    .describe(
      'Share of the box height each row takes, header first, read relative to their sum. A row ' +
        'still grows to fit its text, as a PowerPoint row does. Absent: the rows share the box, ' +
        'each growing to fit its text.',
    ),
  headerRow: z
    .boolean()
    .optional()
    .describe('Whether the first row looks like a header (OOXML firstRow). Absent means true.'),
  bandedRows: z
    .boolean()
    .optional()
    .describe('Whether every other body row is tinted (OOXML bandRow). Absent means false.'),
  bandFill: colorValueSchema
    .optional()
    .describe('Fill of the tinted body rows. Absent: the surface role.'),
  borders: tableBordersSchema
    .nullable()
    .optional()
    .describe('Null for no lines. Absent: a hairline in the line role under every row.'),
  cellStyles: z
    .array(z.array(tableCellStyleSchema.nullable()))
    .optional()
    .describe(
      'Look of each cell, header row first, then by column. A missing or null entry inherits.',
    ),
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
  color: colorValueSchema.describe('A palette role, or a hex value a user chose.'),
  widthEmu: z.number().int().positive().describe('Line width in EMU.'),
  dash: strokeDashSchema,
  head: lineEndSchema.describe('Mark at the start of a line.'),
  tail: lineEndSchema.describe('Mark at the end of a line.'),
});

/**
 * The outline of a shape no named `shape` describes: a freeform (`a:custGeom`) or a preset such as
 * a chevron, as SVG path data. `d` is drawn in a `width` by `height` space stretched over the box,
 * so resizing the element reshapes the outline the way PowerPoint does. A path OOXML marks
 * `fill="none"` or `stroke="0"` keeps that here, as an arrow's open line does.
 */
export const decorGeometrySchema = z.object({
  width: z.number().positive().describe('Width of the space the paths are drawn in.'),
  height: z.number().positive().describe('Height of the space the paths are drawn in.'),
  paths: z
    .array(
      z.object({
        d: z.string().min(1).describe('SVG path data.'),
        filled: z.boolean().describe('False for a path OOXML draws without its fill.'),
        stroked: z.boolean().describe('False for a path OOXML draws without its outline.'),
      }),
    )
    .min(1),
});

/**
 * A shape that holds no content of ours: a panel, a rule or a card from the template, or a shape
 * drawn in the editor.
 *
 * Template decoration may state nothing but its box. Then `shape`, `fill` and `stroke` are absent
 * and a renderer picks a palette role from the geometry. Anything the editor draws states all
 * three, so its look never depends on its size.
 *
 * A closed shape may carry a few words of its own, as a PowerPoint shape does: `paragraphs` is the
 * `p:txBody` of the `p:sp`, centred in the shape unless `verticalAlign` says otherwise. A line
 * never carries text.
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
  geometry: decorGeometrySchema
    .optional()
    .describe('Outline of a geometry `shape` cannot name. When present it is drawn instead.'),
  fill: colorValueSchema
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
  paragraphs: z
    .array(paragraphSchema)
    .min(1)
    .optional()
    .describe('Text inside the shape. Absent when it has none.'),
  verticalAlign: verticalAlignSchema
    .optional()
    .describe('Where the text sits in the shape (the bodyPr anchor). Absent means middle.'),
  textInsets: textInsetsSchema
    .optional()
    .describe('Absent: the OOXML defaults, 0.1 inch left and right and 0.05 inch top and bottom.'),
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
  background: colorValueSchema
    .nullable()
    .optional()
    .describe('Colour the slide is filled with. Null or absent: the template background.'),
  backgroundImage: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Picture the slide is painted with, stretched over it and drawn above `background`: a part ' +
        'name inside the template or a path under the run directory, as an image `mediaPart`.',
    ),
  notes: z
    .string()
    .optional()
    .describe(
      'Speaker notes as plain text, one paragraph of the notes page (`p:notes`) per line. ' +
        'Absent or empty: the slide has none.',
    ),
});

export type LayoutVariantName = z.infer<typeof layoutVariantNameSchema>;
export type ElementRole = z.infer<typeof elementRoleSchema>;
export type VerticalAlign = z.infer<typeof verticalAlignSchema>;
export type DecorShape = z.infer<typeof decorShapeSchema>;
export type StrokeDash = z.infer<typeof strokeDashSchema>;
export type LineEnd = z.infer<typeof lineEndSchema>;
export type ElementStroke = z.infer<typeof elementStrokeSchema>;
export type ImageFit = z.infer<typeof imageFitSchema>;
export type ImageCrop = z.infer<typeof imageCropSchema>;
export type TextInsets = z.infer<typeof textInsetsSchema>;
export type DecorGeometry = z.infer<typeof decorGeometrySchema>;
export type ChartType = z.infer<typeof chartTypeSchema>;
export type TableCellStyle = z.infer<typeof tableCellStyleSchema>;
export type TableBorders = z.infer<typeof tableBordersSchema>;
export type TableElement = z.infer<typeof tableElementSchema>;
export type SlideElement = z.infer<typeof slideElementSchema>;
export type SlideElementKind = SlideElement['kind'];
export type SlideIr = z.infer<typeof slideIrSchema>;
