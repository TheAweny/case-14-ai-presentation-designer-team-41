import { z } from 'zod';
import { jobStageSchema } from './job-event.js';
import { generationUsageSchema } from './generation-usage.js';

/**
 * ArtifactManifest — what a run was made of, written so the run can be defended.
 *
 * The case asks for reproducibility, and reproducibility is a claim about inputs: which agent,
 * which instruction text, which model revision, which seed, which template. A manifest that named
 * only the model would let an edited prompt pass for the same run, so every component is recorded
 * with the hash of what it actually contained.
 *
 * Timings are here for the same reason. The budget is five minutes per deck, and a number nobody
 * recorded is a number nobody can improve.
 */

/** One versioned thing that took part in the run. */
export const componentRevisionSchema = z.object({
  kind: z.enum(['agent', 'prompt', 'model', 'config', 'engine', 'template']),
  id: z.string().min(1).describe('Identifier within its kind, such as an agent id.'),
  version: z
    .string()
    .min(1)
    .describe('Semver for our own components, the provider revision for a model.'),
  hash: z
    .string()
    .length(64)
    .describe('Digest of the exact bytes used, which is what makes the version checkable.'),
});

/** A file the run produced. */
export const runArtifactSchema = z.object({
  kind: z.enum(['deck-plan', 'slide-ir', 'preview', 'pptx', 'pdf', 'html', 'audit']),
  variant: z.enum(['dense', 'balanced', 'airy']).nullable(),
  path: z.string().min(1).describe('Relative to the run directory.'),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

export const stageTimingSchema = z.object({
  stage: jobStageSchema,
  ms: z.number().int().nonnegative(),
});

/** What a model was asked to do and what it cost, one row per call. */
export const modelCallSummarySchema = z.object({
  agentId: z.string().min(1),
  modelId: z.string().min(1),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  runId: z.string().min(1),
  startedAt: z.string().min(1).describe('ISO 8601 timestamp, UTC.'),
  finishedAt: z.string().min(1).describe('ISO 8601 timestamp, UTC.'),
  templateHash: z.string().length(64).describe('Hash of the TemplateIR the run was built on.'),
  contentPackId: z.string().min(1),
  planId: z.string().min(1).describe('The plan all three variants were laid out from.'),
  contentRevision: z.number().int().positive().optional(),
  contentHash: z.string().length(64).optional(),
  seed: z
    .number()
    .int()
    .describe('Seed given to every sampler. The same seed and the same revisions repeat the run.'),
  revisions: z
    .array(componentRevisionSchema)
    .min(1)
    .describe('Every component that could change the output.'),
  modelCalls: z.array(modelCallSummarySchema).describe('Empty for a run on the fake provider.'),
  modelCallsScope: z.enum(['run', 'build']).optional(),
  providerUsage: generationUsageSchema.optional(),
  artifacts: z.array(runArtifactSchema),
  timings: z.array(stageTimingSchema).describe('One entry per stage that ran.'),
  totalMs: z.number().int().nonnegative().describe('Wall clock, against the five minute budget.'),
  appliedPatchIds: z
    .array(z.string().min(1))
    .describe('Fixes the user accepted, so the delivered deck is reproducible too.'),
});

export type ComponentRevision = z.infer<typeof componentRevisionSchema>;
export type RunArtifact = z.infer<typeof runArtifactSchema>;
export type StageTiming = z.infer<typeof stageTimingSchema>;
export type ModelCallSummary = z.infer<typeof modelCallSummarySchema>;
export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
