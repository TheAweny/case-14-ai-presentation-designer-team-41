import { z } from 'zod';

/**
 * JobEvent — one line of what a run is doing, as the interface receives it over SSE.
 *
 * A deck takes minutes, so the progress stream is the product for most of that time. It is
 * written as a discriminated union rather than a percentage because the two things a waiting user
 * wants — what stage we are on, and whether anything has gone wrong — are not derivable from a
 * number.
 *
 * Events are ordered by `seq` within a run and never renumbered. A client that reconnects asks
 * for everything after the last `seq` it saw, which is only sound if the sequence is dense and
 * the events are facts about the past rather than a view of the present.
 */

/** Stages of a run, in the order the pipeline goes through them. */
export const jobStageSchema = z.enum([
  'queued',
  'parsing-template',
  'profiling-template',
  'planning',
  // Pictures for the image slots, drawn once per brief while the copy is written.
  'illustrating',
  'laying-out',
  'rendering',
  'auditing',
  'exporting',
]);

/** Why a run stopped, which decides whether the interface offers to retry. */
export const jobErrorCodeSchema = z.enum([
  'template-unreadable',
  'template-unsupported',
  'content-empty',
  'model-unavailable',
  'model-refused',
  'budget-exceeded',
  'usage-budget-exceeded',
  'account-limit',
  'account-disabled',
  'engine-failed',
  'cancelled',
  'interrupted',
  'provider-rate-limit',
  'provider-auth',
  'provider-quota',
  'provider-timeout',
  'invalid-response',
  'quality-blocked',
  'export-failed',
  'persistence-failed',
  'unknown-outcome',
  'internal',
]);

const base = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative().describe('Dense and increasing within a run.'),
  at: z.string().min(1).describe('ISO 8601 timestamp, UTC.'),
});

export const stageStartedEventSchema = base.extend({
  type: z.literal('stage-started'),
  stage: jobStageSchema,
});

export const stageProgressEventSchema = base.extend({
  type: z.literal('stage-progress'),
  stage: jobStageSchema,
  done: z.number().int().nonnegative().describe('Units finished, usually slides.'),
  total: z.number().int().positive().describe('Units expected.'),
  note: z.string().describe('What it is on right now. Empty when there is nothing to say.'),
});

export const stageFinishedEventSchema = base.extend({
  type: z.literal('stage-finished'),
  stage: jobStageSchema,
  durationMs: z.number().int().nonnegative().describe('Goes into the manifest as a timing.'),
});

/** Something usable exists before the run is over, and the interface can already show it. */
export const artifactReadyEventSchema = base.extend({
  type: z.literal('artifact-ready'),
  kind: z.enum(['deck-plan', 'slide-ir', 'preview', 'pptx', 'pdf', 'html', 'audit', 'manifest']),
  variant: z.enum(['dense', 'balanced', 'airy']).nullable().describe('Null when not per variant.'),
  path: z.string().min(1).describe('Relative to the run directory.'),
});

/** The run continues, but something was lost or guessed and the user should know. */
export const jobWarningEventSchema = base.extend({
  type: z.literal('warning'),
  stage: jobStageSchema,
  code: z.string().min(1),
  message: z.string().min(1),
});

export const jobFailedEventSchema = base.extend({
  type: z.literal('failed'),
  stage: jobStageSchema,
  code: jobErrorCodeSchema,
  message: z.string().min(1).describe('Written for the user, not copied from an exception.'),
  retryable: z.boolean(),
});

export const jobDoneEventSchema = base.extend({
  type: z.literal('done'),
  totalMs: z.number().int().nonnegative(),
  manifestPath: z.string().min(1).describe('Relative to the run directory.'),
});

export const jobEventSchema = z.discriminatedUnion('type', [
  stageStartedEventSchema,
  stageProgressEventSchema,
  stageFinishedEventSchema,
  artifactReadyEventSchema,
  jobWarningEventSchema,
  jobFailedEventSchema,
  jobDoneEventSchema,
]);

export type JobStage = z.infer<typeof jobStageSchema>;
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;
export type JobEvent = z.infer<typeof jobEventSchema>;
