import type { ZodType } from 'zod';
import { healthCheckSchema } from './health.js';
import { runConfigSchema } from './run-config.js';
import { agentConfigSchema } from './agent-config.js';
import { templateIrSchema } from './template-ir.js';
import { contentPackSchema } from './content-pack.js';
import { designSystemSchema } from './design-system.js';
import { patternCatalogSchema } from './pattern-catalog.js';
import { deckPlanSchema } from './deck-plan.js';
import { slideIrSchema } from './slide-ir.js';
import { auditFindingSchema } from './audit-finding.js';
import { auditReportSchema, auditRequestSchema } from './audit-report.js';
import { layoutVariantsRequestSchema, layoutVariantsResponseSchema } from './layout-variants.js';
import { slideReviewSchema } from './slide-review.js';
import { fixPatchSchema } from './fix-patch.js';
import { jobEventSchema } from './job-event.js';
import { artifactManifestSchema } from './artifact-manifest.js';
import { editableDeckRequestSchema, editableDeckResponseSchema } from './editable-deck.js';

/**
 * Every schema that gets exported to JSON Schema and, from there, to Pydantic.
 * Adding a schema here is what makes it visible to the Python engine.
 *
 * The order follows the pipeline rather than the alphabet: a reader meeting these for the first
 * time sees a template become a profile, a profile and a pack become a plan, and a plan become
 * slides, findings and a manifest.
 */
export const contractRegistry = {
  HealthCheck: healthCheckSchema,
  RunConfig: runConfigSchema,
  AgentConfig: agentConfigSchema,
  EditableDeckRequest: editableDeckRequestSchema,
  EditableDeckResponse: editableDeckResponseSchema,
  TemplateIR: templateIrSchema,
  ContentPack: contentPackSchema,
  DesignSystem: designSystemSchema,
  PatternCatalog: patternCatalogSchema,
  DeckPlan: deckPlanSchema,
  SlideIR: slideIrSchema,
  LayoutVariantsRequest: layoutVariantsRequestSchema,
  LayoutVariantsResponse: layoutVariantsResponseSchema,
  AuditFinding: auditFindingSchema,
  AuditRequest: auditRequestSchema,
  AuditReport: auditReportSchema,
  FixPatch: fixPatchSchema,
  SlideReview: slideReviewSchema,
  JobEvent: jobEventSchema,
  ArtifactManifest: artifactManifestSchema,
} satisfies Record<string, ZodType>;

export type ContractName = keyof typeof contractRegistry;
