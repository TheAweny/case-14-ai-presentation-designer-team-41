import { z } from 'zod';
import { boxSchema } from './template-ir.js';
import { slideIntentSchema } from './deck-plan.js';
import { elementRoleSchema } from './slide-ir.js';

/**
 * PatternCatalog — the arrangements a template already knows how to show, found rather than
 * invented.
 *
 * A layout that positioned things by its own taste would produce a deck that is merely tidy. The
 * point of accepting an arbitrary template is to reuse its own decisions, so the parser collects
 * the arrangements that actually recur in the file — a title over two columns, a row of figures,
 * a full-bleed image with a caption — and the layout picks among them.
 *
 * Each pattern says which intents it can serve. That is the join with DeckPlan: the plan asks for
 * a `kpi` slide, and the catalogue answers with whatever this template does for one. A pattern
 * that fits no intent is still listed, because it tells the audit what the template looks like
 * even when nothing is laid out on it.
 */

/** One place content can go inside a pattern. */
export const patternSlotSchema = z.object({
  slotId: z.string().min(1).describe('Unique within the pattern, stable across runs.'),
  role: elementRoleSchema.describe('What belongs here, which decides what may be placed in it.'),
  box: boxSchema.describe('Where the template puts it, in EMU.'),
  optional: z.boolean().describe('True when a slide built on this pattern may leave it empty.'),
  maxChars: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Rough capacity at the template size. Null when the slot is not textual.'),
});

export const patternSchema = z.object({
  patternId: z.string().min(1).describe('Referred to by every SlideIR built on this pattern.'),
  sourceParts: z
    .array(z.string().min(1))
    .min(1)
    .describe('Layout or slide parts this arrangement was observed on.'),
  intents: z
    .array(slideIntentSchema)
    .describe('Plan intents this pattern can serve. Empty when it serves none.'),
  slots: z.array(patternSlotSchema).min(1).describe('In reading order.'),
  occurrences: z
    .number()
    .int()
    .positive()
    .describe('How many times the template uses it. A pattern used once is still a pattern.'),
  density: z
    .number()
    .min(0)
    .max(1)
    .describe('Share of the slide its slots cover, which is what ranks patterns per variant.'),
});

export const patternCatalogSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  templateHash: z
    .string()
    .length(64)
    .describe('Hash of the TemplateIR these patterns were found in.'),
  patterns: z
    .array(patternSchema)
    .min(1)
    .describe('At least one: a template with no usable arrangement is rejected at import.'),
});

export type PatternSlot = z.infer<typeof patternSlotSchema>;
export type Pattern = z.infer<typeof patternSchema>;
export type PatternCatalog = z.infer<typeof patternCatalogSchema>;
