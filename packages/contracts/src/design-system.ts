import { z } from 'zod';
import { boxSchema } from './template-ir.js';

/**
 * DesignSystem — the template read as rules, which is what the layout actually needs.
 *
 * TemplateIR describes the file. This describes what to do with it, and the two disagree often
 * enough that the split is not bookkeeping: in the templates this was written against, the theme
 * declares one typeface while every slide is set in another, and one package's first theme is the
 * stock Office palette while its master uses the brand one. So every value here says where it
 * came from, how much of the template agrees with it, and how far to trust it.
 *
 * Nothing in this schema names a template we have seen. The keys are roles; the values are
 * whatever the extractor measured on the file in front of it.
 */

/** Where a value came from, which is what makes it possible to prefer measurement over theme. */
export const styleSourceSchema = z.enum(['observed', 'theme', 'fallback']);

/**
 * Evidence behind one token.
 *
 * Confidence is reported, never smoothed away. A consumer that gets a low number knows to treat
 * the value as a guess, and the audit can say so, which is the whole point of computing it.
 */
export const tokenMetaSchema = z.object({
  source: styleSourceSchema,
  count: z.number().int().nonnegative().describe('Occurrences that support this value.'),
  share: z.number().min(0).max(1).describe('Share of the relevant population that agrees.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('How far to trust the value. 1 for a measurement nobody contradicts.'),
  parts: z
    .array(z.string())
    .describe('A few parts it was observed on, so the value can be traced back to the file.'),
});

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
  meta: tokenMetaSchema,
});

/**
 * One kind of slide the template draws on, light or dark, with the colours that go on it.
 *
 * Every template examined carries both: dark title and section slides, light content slides.
 * A single background colour cannot describe that, and a layout that picked one would paint
 * dark text on a dark slide the first time it met the other kind.
 */
export const surfaceSchema = z.object({
  tone: z.enum(['light', 'dark']),
  background: hexColorSchema,
  text: hexColorSchema.describe('Text colour observed on this surface, or the best contrast.'),
  accent: hexColorSchema.nullable().describe('Accent observed on this surface, if any.'),
  meta: tokenMetaSchema,
});

export const typeFamilySchema = z.object({
  role: z.enum(['primary', 'secondary', 'mono']),
  font: z.string().min(1),
  declared: z
    .string()
    .describe('What the theme names for this role. Differs from font when the slides disagree.'),
  meta: tokenMetaSchema,
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
  meta: tokenMetaSchema,
});

/**
 * The usable area and the columns inside it, in EMU.
 *
 * Margins come from where the template actually puts its placeholders, so a deck sits on the
 * same lines as the file it was built from. Columns and gutter are not stated anywhere in OOXML;
 * when they cannot be measured they are marked as a fallback rather than presented as found.
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
  meta: tokenMetaSchema,
});

export const strokeTokenSchema = z.object({
  widthPt: z.number().nonnegative(),
  hex: hexColorSchema,
  colorRole: colorRoleSchema.nullable().describe('Palette role this colour matches, if any.'),
  meta: tokenMetaSchema,
});

export const radiusTokenSchema = z.object({
  name: z.enum(['sm', 'md', 'lg']),
  radiusPt: z.number().nonnegative(),
  meta: tokenMetaSchema,
});

export const shadowTokenSchema = z.object({
  present: z.boolean().describe('False when the template draws no shadows. Do not add any.'),
  meta: tokenMetaSchema,
});

/**
 * An area generated content must stay out of: a logo, a footer, a page number.
 *
 * Found by repetition rather than by placeholder type. None of the templates examined uses a
 * page-number or date placeholder, and their logos are ordinary pictures on the master, so a
 * detector that trusted placeholder types would find nothing.
 */
export const protectedZoneSchema = z.object({
  role: z.enum(['logo', 'footer', 'page-number', 'decoration']),
  box: boxSchema.describe('Where it sits, in EMU.'),
  mediaPart: z.string().describe('Image it draws, for a logo. Empty otherwise.'),
  meta: tokenMetaSchema,
});

/** Something the extractor had to guess, override or leave out, stated so it cannot be missed. */
export const designWarningSchema = z.object({
  code: z.enum([
    'observed-overrides-theme',
    'font-unavailable',
    'low-confidence',
    'missing-surface',
    'unresolved-color',
    'theme-missing',
  ]),
  token: z.string().describe('Which token it concerns, such as palette.accent or type.title.'),
  message: z.string().min(1),
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
  surfaces: z.array(surfaceSchema).min(1).describe('One per tone the template uses.'),
  typeFamilies: z.array(typeFamilySchema).min(1),
  typeScale: z.array(typeStyleSchema).min(1).describe('One entry per role in use.'),
  grid: gridSchema,
  strokes: z.array(strokeTokenSchema).describe('Outline styles in use, most common first.'),
  radii: z.array(radiusTokenSchema).describe('Corner radii in use, smallest first.'),
  shadows: shadowTokenSchema,
  protectedZones: z.array(protectedZoneSchema),
  warnings: z
    .array(designWarningSchema)
    .describe('Empty only when every token was measured with confidence.'),
});

export type StyleSource = z.infer<typeof styleSourceSchema>;
export type TokenMeta = z.infer<typeof tokenMetaSchema>;
export type ColorRole = z.infer<typeof colorRoleSchema>;
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export type Surface = z.infer<typeof surfaceSchema>;
export type TypeFamily = z.infer<typeof typeFamilySchema>;
export type TypeRole = z.infer<typeof typeRoleSchema>;
export type TypeStyle = z.infer<typeof typeStyleSchema>;
export type Grid = z.infer<typeof gridSchema>;
export type StrokeToken = z.infer<typeof strokeTokenSchema>;
export type RadiusToken = z.infer<typeof radiusTokenSchema>;
export type ShadowToken = z.infer<typeof shadowTokenSchema>;
export type ProtectedZone = z.infer<typeof protectedZoneSchema>;
export type DesignWarning = z.infer<typeof designWarningSchema>;
export type DesignSystem = z.infer<typeof designSystemSchema>;
