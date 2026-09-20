import { z } from 'zod';

/**
 * DesignSystem — the template read as rules, which is what the layout actually needs.
 *
 * TemplateIR describes the file. This describes what to do with it, and the two disagree often
 * enough that the split is not bookkeeping: in the templates this was written against, the theme
 * declares one typeface while every slide is set in another, and a layout that trusted the
 * declaration would produce a deck that does not look like the template it came from. So every
 * value here records whether it was observed on the slides or merely declared by the theme, and
 * the layout is free to prefer the former.
 *
 * Nothing in this schema names a template we have seen. The keys are roles; the values are
 * whatever the parser measured on the file in front of it.
 */

/** Where a value came from, which is what makes it possible to prefer measurement over theme. */
export const styleSourceSchema = z.enum(['observed', 'theme', 'fallback']);

/** Six hex digits, upper or lower case, without a leading hash. */
export const hexColorSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/)
  .describe('Six hex digits, no leading hash.');

/**
 * What a colour is for, rather than what it looks like.
 *
 * A layout asks for `accent` and gets whatever the template uses as one. Asking for a literal
 * colour is what hardcoding to a template looks like in practice.
 */
export const colorRoleSchema = z.enum([
  'background',
  'surface',
  'text',
  'text-muted',
  'text-on-accent',
  'accent',
  'accent-alt',
  'line',
  'positive',
  'negative',
]);

export const paletteEntrySchema = z.object({
  role: colorRoleSchema,
  hex: hexColorSchema,
  source: styleSourceSchema,
  coverage: z
    .number()
    .min(0)
    .max(1)
    .describe('Share of the template this colour covers. Zero for a purely declared value.'),
});

/** What a run of text is for. The type scale answers in points, per template. */
export const typeRoleSchema = z.enum([
  'title',
  'subtitle',
  'heading',
  'body',
  'bullet',
  'caption',
  'kpi-value',
  'kpi-caption',
  'quote',
  'footer',
]);

export const typeStyleSchema = z.object({
  role: typeRoleSchema,
  font: z.string().min(1).describe('Typeface to set this role in.'),
  sizePt: z.number().positive().describe('Size in points.'),
  bold: z.boolean(),
  italic: z.boolean(),
  lineSpacing: z.number().positive().describe('Multiple of the line height, 1 for single.'),
  colorRole: colorRoleSchema.describe('Which palette role this text takes its colour from.'),
  source: styleSourceSchema,
});

/**
 * The usable area and the columns inside it, in EMU.
 *
 * Margins are derived from where the template actually places its placeholders, not from a
 * round number we like, so a deck sits on the same lines as the file it was built from.
 */
export const gridSchema = z.object({
  slideCx: z.number().int().positive().describe('Slide width in EMU.'),
  slideCy: z.number().int().positive().describe('Slide height in EMU.'),
  marginLeft: z.number().int().nonnegative(),
  marginRight: z.number().int().nonnegative(),
  marginTop: z.number().int().nonnegative(),
  marginBottom: z.number().int().nonnegative(),
  columns: z.number().int().positive().describe('Columns the content area divides into.'),
  gutter: z.number().int().nonnegative().describe('Space between columns in EMU.'),
  baseline: z.number().int().positive().describe('Vertical step layout snaps to, in EMU.'),
});

/** An asset the template carries that a deck should keep using, such as a logo. */
export const brandAssetSchema = z.object({
  mediaPart: z.string().min(1).describe('Part name inside the template package.'),
  role: z.enum(['logo', 'background', 'decoration']),
  widthPx: z.number().int().nullable(),
  heightPx: z.number().int().nullable(),
});

export const designSystemSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  templateHash: z
    .string()
    .length(64)
    .describe('Hash of the TemplateIR this was derived from, so the pair can be checked.'),
  aspect: z.string().describe('Aspect ratio in lowest terms, such as 16:9.'),
  palette: z
    .array(paletteEntrySchema)
    .min(1)
    .describe('One entry per role the template supports. Roles it lacks are simply absent.'),
  typeScale: z.array(typeStyleSchema).min(1).describe('One entry per role in use.'),
  grid: gridSchema,
  assets: z.array(brandAssetSchema).describe('Empty when the template carries no imagery.'),
  notes: z
    .array(z.string().min(1))
    .describe('What had to be inferred, for a reader wondering why a value looks odd.'),
});

export type StyleSource = z.infer<typeof styleSourceSchema>;
export type ColorRole = z.infer<typeof colorRoleSchema>;
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export type TypeRole = z.infer<typeof typeRoleSchema>;
export type TypeStyle = z.infer<typeof typeStyleSchema>;
export type Grid = z.infer<typeof gridSchema>;
export type BrandAsset = z.infer<typeof brandAssetSchema>;
export type DesignSystem = z.infer<typeof designSystemSchema>;
