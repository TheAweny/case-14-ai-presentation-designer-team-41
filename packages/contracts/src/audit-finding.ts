import { z } from 'zod';
import { boxSchema } from './template-ir.js';
import { sourceRefSchema } from './deck-plan.js';
import { fixPatchBodySchema } from './fix-patch.js';

/**
 * AuditFinding — one thing wrong with one slide, stated so that three different readers can act
 * on it.
 *
 * The interface draws it over the slide, so it carries the element and the rectangle. The user
 * decides whether to accept it, so it carries evidence and a confidence rather than a verdict.
 * An agent may act on it, so it carries a patch when one can be proposed. Dropping any of the
 * three turns the audit into a number nobody can do anything with.
 *
 * Deterministic checks and contextual ones produce the same shape on purpose. A measured contrast
 * ratio and a model's judgement that a headline does not match its slide differ in `confidence`
 * and in `origin`, not in how the rest of the system handles them.
 */

/** How much the finding matters. `blocker` is reserved for output that is simply wrong. */
export const severitySchema = z.enum(['blocker', 'major', 'minor', 'info']);

/** Whether it was measured or judged, which is what a confidence below one means. */
export const findingOriginSchema = z.enum(['deterministic', 'contextual']);

/**
 * What can be done about it, which decides what the interface offers.
 *
 * `auto` carries a patch the engine can apply on its own, `assisted` one that needs a model to
 * write something first, `manual` none at all.
 */
export const fixabilitySchema = z.enum(['auto', 'assisted', 'manual']);

/** What the check looked at. */
export const findingTargetSchema = z.object({
  slideId: z.string().min(1),
  variant: z.enum(['dense', 'balanced', 'airy']),
  elementId: z
    .string()
    .min(1)
    .nullable()
    .describe('Null when the finding is about the slide as a whole.'),
  box: boxSchema.nullable().describe('Rectangle to draw the finding on. Null when it has none.'),
});

/**
 * Why the check believes it.
 *
 * A measurement states the number it took and the threshold it failed; a judgement quotes the
 * text it read. Both are required because a finding the user cannot check is a finding the user
 * will learn to ignore.
 */
export const findingEvidenceSchema = z.object({
  measured: z.string().describe('The value observed, rendered for display. Empty if not numeric.'),
  expected: z.string().describe('The rule it failed, rendered for display.'),
  quote: z.string().describe('The text the judgement rests on. Empty for a measurement.'),
  sources: z
    .array(sourceRefSchema)
    .describe('Content this was checked against, for claims about the source material.'),
  screenshot: z
    .string()
    .describe('Path to a crop under the run directory, when the check rendered one.'),
});

export const auditFindingSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  findingId: z.string().min(1).describe('Stable for a given run, so a decision can be recorded.'),
  checkId: z
    .string()
    .min(1)
    .describe('The check that raised it, as registered. docs/AUDIT.md is generated from these.'),
  origin: findingOriginSchema,
  severity: severitySchema,
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('One for a measurement. Below one only for a judgement.'),
  title: z.string().min(1).describe('What is wrong, in a few words.'),
  detail: z.string().min(1).describe('Why it is wrong, in a sentence a user can act on.'),
  target: findingTargetSchema,
  evidence: findingEvidenceSchema,
  fixability: fixabilitySchema,
  proposedPatch: fixPatchBodySchema
    .nullable()
    .describe('Null when nothing can be proposed, which is what `manual` means.'),
});

export type Severity = z.infer<typeof severitySchema>;
export type FindingOrigin = z.infer<typeof findingOriginSchema>;
export type Fixability = z.infer<typeof fixabilitySchema>;
export type FindingTarget = z.infer<typeof findingTargetSchema>;
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;
export type AuditFinding = z.infer<typeof auditFindingSchema>;
