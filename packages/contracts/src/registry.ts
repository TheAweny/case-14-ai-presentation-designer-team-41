import {
  compositionCheckResponseSchema,
  generationProfileSchema,
  compositionExportRequestSchema,
  compositionExportResponseSchema,
} from './generation.js';
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
import {
  visualBuildRequestSchema,
  visualBuildResponseSchema,
  visualCapabilitySchema,
  visualCompareRequestSchema,
  visualCompareResponseSchema,
} from './visuals.js';
import { auditFindingSchema } from './audit-finding.js';
import { auditReportSchema, auditRequestSchema } from './audit-report.js';
import { layoutVariantsRequestSchema, layoutVariantsResponseSchema } from './layout-variants.js';
import { slideReviewSchema } from './slide-review.js';
import { deckExportRequestSchema, deckExportResponseSchema } from './deck-export.js';
import { copyEditsSchema } from './copy-edits.js';
import { fixPatchSchema } from './fix-patch.js';
import { jobEventSchema } from './job-event.js';
import { artifactManifestSchema } from './artifact-manifest.js';
import { editableDeckRequestSchema, editableDeckResponseSchema } from './editable-deck.js';
import { deckImportRequestSchema, deckImportResponseSchema } from './deck-import.js';
import {
  templatePreviewsRequestSchema,
  templatePreviewsResponseSchema,
} from './template-previews.js';
import {
  materialExtractRequestSchema,
  materialExtractResponseSchema,
} from './material-extraction.js';

/**
 * Every schema that gets exported to JSON Schema and, from there, to Pydantic.
 * Adding a schema here is what makes it visible to the Python engine.
 *
 * The order follows the pipeline rather than the alphabet: a reader meeting these for the first
 * time sees a template become a profile, a profile and a pack become a plan, and a plan become
 * slides, findings and a manifest.
 */
export const contractRegistry = {
  CompositionCheckResponse: compositionCheckResponseSchema,
  GenerationProfile: generationProfileSchema,
  CompositionExportRequest: compositionExportRequestSchema,
  CompositionExportResponse: compositionExportResponseSchema,
  HealthCheck: healthCheckSchema,
  RunConfig: runConfigSchema,
  AgentConfig: agentConfigSchema,
  EditableDeckRequest: editableDeckRequestSchema,
  EditableDeckResponse: editableDeckResponseSchema,
  TemplateIR: templateIrSchema,
  TemplatePreviewsRequest: templatePreviewsRequestSchema,
  TemplatePreviewsResponse: templatePreviewsResponseSchema,
  MaterialExtractRequest: materialExtractRequestSchema,
  MaterialExtractResponse: materialExtractResponseSchema,
  ContentPack: contentPackSchema,
  DesignSystem: designSystemSchema,
  PatternCatalog: patternCatalogSchema,
  DeckPlan: deckPlanSchema,
  SlideIR: slideIrSchema,
  VisualBuildRequest: visualBuildRequestSchema,
  VisualBuildResponse: visualBuildResponseSchema,
  VisualCapability: visualCapabilitySchema,
  VisualCompareRequest: visualCompareRequestSchema,
  VisualCompareResponse: visualCompareResponseSchema,
  DeckExportRequest: deckExportRequestSchema,
  DeckExportResponse: deckExportResponseSchema,
  DeckImportRequest: deckImportRequestSchema,
  DeckImportResponse: deckImportResponseSchema,
  LayoutVariantsRequest: layoutVariantsRequestSchema,
  LayoutVariantsResponse: layoutVariantsResponseSchema,
  AuditFinding: auditFindingSchema,
  AuditRequest: auditRequestSchema,
  AuditReport: auditReportSchema,
  FixPatch: fixPatchSchema,
  SlideReview: slideReviewSchema,
  CopyEdits: copyEditsSchema,
  JobEvent: jobEventSchema,
  ArtifactManifest: artifactManifestSchema,
} satisfies Record<string, ZodType>;

export type ContractName = keyof typeof contractRegistry;
