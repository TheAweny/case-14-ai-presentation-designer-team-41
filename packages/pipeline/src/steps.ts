/**
 * Step registry of the deck workflow.
 *
 * The workflow is assembled from named steps so a run manifest can point at the exact step
 * sequence that produced a deck. Steps are added here as they are implemented; the pipeline
 * plans a deck once and reuses that plan for every layout variant.
 */
export const PIPELINE_STEP_IDS = [
  'import-template',
  'plan-deck',
  'write-slides',
  'layout-variants',
  'audit',
  'export',
] as const;

export type PipelineStepId = (typeof PIPELINE_STEP_IDS)[number];

/** Steps registered so far, keyed by id. Empty while the workflow is being built. */
export const pipelineSteps: Partial<Record<PipelineStepId, never>> = {};
