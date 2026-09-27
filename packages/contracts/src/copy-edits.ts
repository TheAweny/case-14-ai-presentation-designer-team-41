import { z } from 'zod';

/**
 * CopyEdits — shorter wording for the parts of a plan the layout could not fit.
 *
 * The layout never cuts text. It reports what overflows, and the copy-fitter agent answers with
 * new wording for exactly those parts, each within the length it was given. An edit names the
 * part by its path in the planned slide, so it can be applied to the plan and checked: it has
 * to be shorter and has to keep every figure of the text it replaces.
 */

export const copyEditSchema = z.object({
  slideId: z.string().min(1),
  path: z
    .string()
    .regex(
      /^(headline|subhead|blocks\.\d+\.(text|items\.\d+))$/,
      'A path is headline, subhead, blocks.N.text or blocks.N.items.M.',
    )
    .describe('Which part of the planned slide the text replaces.'),
  text: z.string().min(1).describe('The new wording.'),
});

export const copyEditsSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  edits: z
    .array(copyEditSchema)
    .describe('One per part asked about. Empty when nothing can be cut.'),
});

export type CopyEdit = z.infer<typeof copyEditSchema>;
export type CopyEdits = z.infer<typeof copyEditsSchema>;
