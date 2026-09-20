import { z } from 'zod';
import { boxSchema, paragraphSchema } from './template-ir.js';
import { colorRoleSchema } from './design-system.js';

/**
 * FixPatch — a change proposed for one slide, small enough that a user can accept it alone.
 *
 * The audit does not repair anything by itself. It says what is wrong and offers this, and the
 * user decides. That is a product decision the case asks for, and it has a structural
 * consequence: a patch has to be described rather than performed, because the description is
 * what the interface shows and what the engine later replays.
 *
 * Only operations the engine can apply deterministically belong here. Rewriting copy is the one
 * thing on this list that needs a model, and it arrives already written, as `set-text`: the
 * agent on the TypeScript side produces the words, and the engine only puts them where they go.
 */

/** Replace the text of one element with text an agent has already written. */
export const setTextOpSchema = z.object({
  op: z.literal('set-text'),
  elementId: z.string().min(1),
  paragraphs: z.array(paragraphSchema).min(1).describe('The new copy, already fitted.'),
});

/** Step one element down the template type scale, for text that overflows by a little. */
export const setFontSizeOpSchema = z.object({
  op: z.literal('set-font-size'),
  elementId: z.string().min(1),
  sizePt: z.number().positive().describe('Must be a size the DesignSystem type scale allows.'),
});

export const moveOpSchema = z.object({
  op: z.literal('move'),
  elementId: z.string().min(1),
  box: boxSchema.describe('New geometry in EMU, snapped to the template grid.'),
});

export const setColorOpSchema = z.object({
  op: z.literal('set-color'),
  elementId: z.string().min(1),
  colorRole: colorRoleSchema.describe('A role, never a literal colour: the template supplies it.'),
});

export const removeOpSchema = z.object({
  op: z.literal('remove'),
  elementId: z.string().min(1),
});

/** Lay the slide out again on a different arrangement from the template's own catalogue. */
export const repatternOpSchema = z.object({
  op: z.literal('repattern'),
  patternId: z.string().min(1).describe('A pattern from the PatternCatalog of this template.'),
});

export const patchOpSchema = z.discriminatedUnion('op', [
  setTextOpSchema,
  setFontSizeOpSchema,
  moveOpSchema,
  setColorOpSchema,
  removeOpSchema,
  repatternOpSchema,
]);

/**
 * The patch without its envelope, so a finding can carry one without nesting a second
 * `schemaVersion` inside itself.
 */
export const fixPatchBodySchema = z.object({
  patchId: z.string().min(1),
  findingId: z
    .string()
    .min(1)
    .nullable()
    .describe('The finding this answers. Null when the user asked for the change directly.'),
  slideId: z.string().min(1),
  variant: z.enum(['dense', 'balanced', 'airy']),
  ops: z.array(patchOpSchema).min(1).describe('Applied in order, all of them or none.'),
  rationale: z.string().min(1).describe('One sentence, shown next to the button that applies it.'),
  touchesCopy: z
    .boolean()
    .describe('True when a model wrote words here, which the manifest has to record.'),
});

export const fixPatchSchema = fixPatchBodySchema.extend({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
});

export type PatchOp = z.infer<typeof patchOpSchema>;
export type FixPatchBody = z.infer<typeof fixPatchBodySchema>;
export type FixPatch = z.infer<typeof fixPatchSchema>;
