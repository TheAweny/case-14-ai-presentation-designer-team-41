import { z } from 'zod';

/**
 * TemplateIR — what the parser establishes about an uploaded template, before anyone
 * interprets it.
 *
 * This schema deliberately describes the file rather than our reading of it. Which values
 * actually characterise a template is a separate question, answered by DesignSystem: in the
 * templates this was written against, the theme names one typeface while the slides are set in
 * another, so a consumer that trusted the theme alone would get it wrong. Keeping both the
 * declared and the observed values available is what makes that resolvable later.
 */

/** Geometry in English Metric Units, exactly as OOXML stores it. */
export const boxSchema = z.object({
  x: z.number().int().describe('Left edge in EMU.'),
  y: z.number().int().describe('Top edge in EMU.'),
  cx: z.number().int().describe('Width in EMU.'),
  cy: z.number().int().describe('Height in EMU.'),
});

/**
 * A colour as the file states it: an explicit value or a theme slot, never resolved by the
 * parser. Resolving needs the master's colour map and theme, and doing it at parse time would
 * hide the difference between a brand colour the template inherits and a one-off override.
 */
export const colorRefSchema = z.object({
  hex: z.string().describe('Six hex digits when stated outright, otherwise empty.'),
  scheme: z
    .string()
    .describe('Theme slot or alias (accent1, tx1, bg2 ...) when it refers to the theme.'),
  transforms: z
    .array(z.tuple([z.string(), z.number().int()]))
    .describe('lumMod, lumOff, tint, shade and the like, in thousandths of a percent.'),
});

/** How an area is painted. */
export const fillSchema = z.object({
  kind: z.enum(['solid', 'gradient', 'image', 'pattern', 'none']),
  color: colorRefSchema.nullable().describe('Set for a solid fill.'),
  stops: z.array(colorRefSchema).describe('Gradient stops in order, for a gradient fill.'),
});

/** The outline a shape states for itself. */
export const strokeSchema = z.object({
  visible: z.boolean().describe('False when the outline is explicitly switched off.'),
  color: colorRefSchema.nullable(),
  widthEmu: z.number().int().nonnegative().nullable(),
});

/** One text run with the formatting stated on the run itself. */
export const textRunSchema = z.object({
  text: z.string().describe('Literal text of the run.'),
  font: z.string().describe('Typeface named on the run. Empty when it inherits from the theme.'),
  sizePt: z.number().nullable().describe('Size in points, or null when inherited.'),
  bold: z.boolean().nullable().describe('Null when inherited.'),
  italic: z.boolean().nullable().describe('Null when inherited.'),
  color: z
    .string()
    .describe('Six-digit hex when the run states a colour. Empty when it inherits one.'),
});

/** A paragraph and its runs. The level drives bullet depth. */
export const paragraphSchema = z.object({
  level: z.number().int().nonnegative().describe('Indent level, zero at the top.'),
  runs: z.array(textRunSchema).describe('Runs in reading order.'),
  lineSpacing: z
    .number()
    .positive()
    .nullable()
    .describe('Multiple of single spacing, when stated as a percentage.'),
});

/** Placeholder identity, present only on shapes that inherit from a layout. */
export const placeholderRefSchema = z.object({
  type: z.string().describe('Placeholder type, lower-cased and hyphenated.'),
  idx: z.number().int().nullable().describe('Placeholder index within the layout.'),
});

/**
 * One shape, flattened out of its group.
 *
 * `shapeId` together with the owning part is the object identity the renderer, the audit and
 * the frontend overlay all refer to, so a finding can point at the shape it came from.
 */
export const shapeSchema = z.object({
  shapeId: z.number().int().describe('OOXML shape id, unique within its part.'),
  name: z.string().describe('Name the authoring tool gave the shape.'),
  kind: z.string().describe('Shape kind: auto-shape, text-box, picture, table, chart, group.'),
  box: boxSchema.nullable().describe('Null when the shape inherits its position from a layout.'),
  rotation: z.number().describe('Rotation in degrees, clockwise.'),
  flipH: z.boolean().describe('Mirrored horizontally.'),
  flipV: z.boolean().describe('Mirrored vertically.'),
  z: z.number().int().nonnegative().describe('Paint order within the parent, lowest first.'),
  path: z
    .array(z.number().int())
    .describe('Ids of the groups this shape sits in, outermost first. Empty at the top level.'),
  placeholder: placeholderRefSchema.nullable(),
  paragraphs: z.array(paragraphSchema).describe('Text of the shape, empty when it carries none.'),
  mediaPart: z.string().describe('Part name of the image this shape draws, for pictures.'),
  tableSize: z
    .tuple([z.number().int(), z.number().int()])
    .nullable()
    .describe('Rows and columns, for tables.'),
  chartPart: z.string().describe('Part name of the chart, for charts.'),
  chartType: z.string().describe('Chart type, lower-cased and hyphenated.'),
  fill: fillSchema.nullable().describe('Null when the shape inherits its fill.'),
  stroke: strokeSchema.nullable().describe('Null when the shape inherits its outline.'),
  geometry: z.string().describe('Preset geometry such as rect or roundRect, empty otherwise.'),
  cornerRadiusEmu: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .describe('Corner radius of a rounded rectangle, from its adjust value and size.'),
  hasShadow: z.boolean().describe('Whether the shape states an outer shadow of its own.'),
});

/** A slide, a layout or a master: one structure at three levels of inheritance. */
export const slideLikeSchema = z.object({
  part: z.string().min(1).describe('Package part name, which identifies it.'),
  name: z.string().describe('Name from the file, or a generated one for slides.'),
  follows: z
    .string()
    .describe('Part this one inherits from: a layout for a slide, a master for a layout.'),
  shapes: z.array(shapeSchema).describe('Shapes in paint order, groups flattened.'),
  background: fillSchema.nullable().describe('Null when the part inherits its background.'),
  theme: z.string().describe('For a master, the theme part it uses. Empty below the master.'),
  colorMap: z
    .array(z.tuple([z.string(), z.string()]))
    .describe('Alias to slot map (bg1 to lt1 ...). In full on a master, overrides below it.'),
});

/** The colour scheme of one theme, resolved to hex where OOXML states it outright. */
export const themeColorsSchema = z.object({
  name: z.string().describe('Name the theme gives its colour scheme.'),
  slots: z
    .array(z.tuple([z.string(), z.string()]))
    .describe('Slot name and hex value. An empty value means the slot is indirect.'),
  part: z.string().describe('Theme part this scheme lives in, as a master names it.'),
});

/** Typefaces the theme declares, which a template is free to contradict. */
export const themeFontsSchema = z.object({
  majorLatin: z.string().describe('Latin typeface for headings, as declared.'),
  minorLatin: z.string().describe('Latin typeface for body text, as declared.'),
});

/** One file in ppt/media, described without being copied anywhere. */
export const mediaItemSchema = z.object({
  part: z.string().min(1).describe('Package part name.'),
  contentType: z.string().describe('File extension, lower-cased.'),
  bytes: z.number().int().nonnegative().describe('Size of the part.'),
  widthPx: z.number().int().nullable().describe('Pixel width, null for non-raster parts.'),
  heightPx: z.number().int().nullable().describe('Pixel height, null for non-raster parts.'),
});

/** Codes for the things a parser can meet but not represent fully. */
export const parseWarningCodeSchema = z.enum([
  'unsupported-shape',
  'unresolved-color',
  'missing-font-scheme',
  'missing-theme',
  'embedded-font-ignored',
  'unreadable-media',
  'no-slide-layout',
]);

/** One recoverable problem, with enough context to act on it. */
export const parseWarningSchema = z.object({
  code: parseWarningCodeSchema,
  message: z.string().min(1).describe('What happened, in a sentence.'),
  location: z.string().describe('Part name, or a part and shape id.'),
});

/** Everything the parser could establish, plus what it could not. */
export const templateIrSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  sourceName: z.string().describe('File name of the upload, kept out of the hash.'),
  slideCx: z.number().int().positive().describe('Slide width in EMU.'),
  slideCy: z.number().int().positive().describe('Slide height in EMU.'),
  aspect: z.string().describe('Aspect ratio in lowest terms, such as 16:9.'),
  hash: z
    .string()
    .length(64)
    .describe('Digest over the canonical IR. Two runs over one file agree; the name is excluded.'),
  themeColors: z.array(themeColorsSchema).describe('One entry per theme part.'),
  themeFonts: themeFontsSchema,
  masters: z.array(slideLikeSchema),
  layouts: z.array(slideLikeSchema),
  slides: z.array(slideLikeSchema),
  media: z.array(mediaItemSchema).describe('Inventory of ppt/media, ordered by part name.'),
  warnings: z.array(parseWarningSchema).describe('Empty when nothing was lost.'),
});

export type ColorRef = z.infer<typeof colorRefSchema>;
export type Fill = z.infer<typeof fillSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Box = z.infer<typeof boxSchema>;
export type TextRun = z.infer<typeof textRunSchema>;
export type Paragraph = z.infer<typeof paragraphSchema>;
export type PlaceholderRef = z.infer<typeof placeholderRefSchema>;
export type Shape = z.infer<typeof shapeSchema>;
export type SlideLike = z.infer<typeof slideLikeSchema>;
export type ThemeColors = z.infer<typeof themeColorsSchema>;
export type ThemeFonts = z.infer<typeof themeFontsSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;
export type ParseWarningCode = z.infer<typeof parseWarningCodeSchema>;
export type ParseWarning = z.infer<typeof parseWarningSchema>;
export type TemplateIr = z.infer<typeof templateIrSchema>;
