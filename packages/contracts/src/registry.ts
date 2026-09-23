import type { ZodType } from 'zod';
import { agentConfigSchema } from './agent-config.js';
import {
  artifactManifestSchema,
  auditFindingSchema,
  deckPlanSchema,
  runEventSchema,
  slideIrSchema,
  templateProfileSchema,
} from './deck-contracts.js';
import { healthCheckSchema } from './health.js';
import { runConfigSchema } from './run-config.js';

export const contractRegistry = {
  HealthCheck: healthCheckSchema,
  RunConfig: runConfigSchema,
  AgentConfig: agentConfigSchema,
  TemplateProfile: templateProfileSchema,
  DeckPlan: deckPlanSchema,
  SlideIR: slideIrSchema,
  AuditFinding: auditFindingSchema,
  ArtifactManifest: artifactManifestSchema,
  RunEvent: runEventSchema,
} satisfies Record<string, ZodType>;

export type ContractName = keyof typeof contractRegistry;
