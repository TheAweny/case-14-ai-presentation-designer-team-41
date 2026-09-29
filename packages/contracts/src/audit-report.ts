import { z } from 'zod';
import { auditFindingSchema, severitySchema } from './audit-finding.js';
import { designSystemSchema } from './design-system.js';
import { patternCatalogSchema } from './pattern-catalog.js';
import { slideIrSchema } from './slide-ir.js';

/**
 * AuditRequest and AuditReport — the verification step between whatever generated a deck and
 * the user who receives it.
 *
 * The generator, a model on a GPU or the local layout, writes SlideIR. Nothing it writes is
 * trusted: the engine measures every slide against the template it claims to follow and against
 * the readability limits of the audit profile, and answers with findings rather than a verdict
 * alone. The request carries everything the checks need, so the engine does not have to find the
 * template again, and the report says both whether the deck may ship and what to change if not.
 */

/** Which part of the requirements a check belongs to. The report is grouped by it. */
export const checkCategorySchema = z.enum(['layout', 'template', 'density', 'integrity']);

/** Pixel size of a picture, for the distortion check when the file itself is not at hand. */
export const mediaSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const auditRequestSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  deckId: z.string().min(1).describe('Echoed back, so a caller can match the report to a deck.'),
  slides: z.array(slideIrSchema).min(1).describe('The deck under audit, any number of variants.'),
  designSystem: designSystemSchema.describe('The template read as rules: fonts, sizes, palette.'),
  patternCatalog: patternCatalogSchema
    .nullable()
    .describe('Arrangements of the template. Null skips the check that slides use one.'),
  profile: z
    .string()
    .min(1)
    .optional()
    .describe('Audit profile from configs/audit.yaml that sets the thresholds. Absent: default.'),
  mediaSizes: z
    .record(z.string(), mediaSizeSchema)
    .optional()
    .describe('Pixel size per mediaPart, for pictures the engine cannot open itself.'),
  slotSamples: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
    .describe(
      'Text each element showed in the template sample it was built from, by slideId and ' +
        'elementId. Lets the audit tell template copy left in place.',
    ),
  today: z.iso
    .date()
    .optional()
    .describe('The day the deck is dated by; earlier years are past. Absent: today.'),
  knownYears: z
    .array(z.number().int())
    .optional()
    .describe('Years the source content names; a past year it names is not stale.'),
});

export const categorySummarySchema = z.object({
  category: checkCategorySchema,
  checks: z.number().int().nonnegative().describe('Checks of this category that ran.'),
  findings: z.number().int().nonnegative(),
  passed: z.boolean().describe('True when no finding of this category blocks the deck.'),
});

export const auditReportSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  deckId: z.string().min(1),
  profile: z.string().min(1),
  passed: z
    .boolean()
    .describe('True when nothing of blocker or major severity was found: the deck may ship.'),
  score: z
    .number()
    .min(0)
    .max(100)
    .describe('100 minus weighted findings per slide. For ranking variants, not for gating.'),
  slideCount: z.number().int().nonnegative(),
  counts: z.record(severitySchema, z.number().int().nonnegative()),
  categories: z.array(categorySummarySchema),
  findings: z.array(auditFindingSchema).describe('In slide order, then by check.'),
});

export type CheckCategory = z.infer<typeof checkCategorySchema>;
export type MediaSize = z.infer<typeof mediaSizeSchema>;
export type AuditRequest = z.infer<typeof auditRequestSchema>;
export type CategorySummary = z.infer<typeof categorySummarySchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
