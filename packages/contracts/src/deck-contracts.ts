import { z } from 'zod';

export const CONTRACT_SCHEMA_VERSION = '1.0.0';

const schemaVersionSchema = z.literal(CONTRACT_SCHEMA_VERSION);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest.');
const stableIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'Expected a lowercase stable id.');

export const boundingBoxSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const sourceReferenceSchema = z.object({
  sourceId: stableIdSchema.describe('Stable identifier of an input content item.'),
  location: z.string().min(1).describe('Location within the input content item.'),
});

const protectedElementSchema = z.object({
  objectId: stableIdSchema,
  kind: z.enum(['logo', 'footer', 'page-number', 'background']),
  bbox: boundingBoxSchema,
});

const typographyTokenSchema = z.object({
  family: z.string().min(1),
  sizePt: z.number().positive(),
  weight: z.number().int().min(100).max(900),
});

export const templateProfileSchema = z.object({
  schemaVersion: schemaVersionSchema,
  templateId: stableIdSchema,
  sourceSha256: sha256Schema,
  slideSize: z.object({ widthPt: z.number().positive(), heightPt: z.number().positive() }),
  palette: z.array(z.string().regex(/^#[A-Fa-f0-9]{6}$/)).max(32),
  typography: z.array(typographyTokenSchema).max(32),
  protectedElements: z.array(protectedElementSchema),
});

const plannedSlideSchema = z.object({
  slideId: stableIdSchema,
  title: z.string().min(1),
  intent: z.string().min(1),
  sourceRefs: z.array(sourceReferenceSchema).min(1),
});

export const deckPlanSchema = z.object({
  schemaVersion: schemaVersionSchema,
  runId: stableIdSchema,
  slides: z.array(plannedSlideSchema).min(1).max(15),
});

const slideObjectSchema = z.object({
  objectId: stableIdSchema,
  kind: z.enum(['text', 'shape', 'image', 'table', 'chart', 'diagram']),
  bbox: boundingBoxSchema,
  text: z.string().min(1).optional(),
});

export const slideIrSchema = z.object({
  schemaVersion: schemaVersionSchema,
  slideId: stableIdSchema,
  objects: z.array(slideObjectSchema),
});

const editableDeckSlideSchema = z.object({
  slideId: stableIdSchema,
  title: z.string().min(1),
  body: z.string().min(1),
});

export const editableDeckRequestSchema = z.object({
  runId: stableIdSchema,
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  slides: z.array(editableDeckSlideSchema).min(1).max(15),
});

export const editableDeckResponseSchema = z.object({
  outputPath: z.string().min(1),
  profile: templateProfileSchema,
  slideCount: z.number().int().positive(),
});

export const auditFindingSchema = z.object({
  schemaVersion: schemaVersionSchema,
  findingId: stableIdSchema,
  ruleId: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error']),
  slideId: stableIdSchema,
  objectId: stableIdSchema.optional(),
  bbox: boundingBoxSchema.optional(),
  evidence: z.string().min(1),
});

const artifactVariantSchema = z.object({
  variantId: stableIdSchema,
  strategy: z.enum(['concise', 'visual', 'analytical']),
  pptxPath: z.string().min(1),
  sha256: sha256Schema,
});

export const artifactManifestSchema = z.object({
  schemaVersion: schemaVersionSchema,
  runId: stableIdSchema,
  inputHashes: z.object({ template: sha256Schema, content: sha256Schema }),
  gitSha: z.string().regex(/^[a-f0-9]{40}$/),
  seed: z.number().int().nonnegative(),
  variants: z.array(artifactVariantSchema).length(3),
});

export const runEventSchema = z.object({
  schemaVersion: schemaVersionSchema,
  runId: stableIdSchema,
  sequence: z.number().int().nonnegative(),
  stage: z.enum([
    'validating',
    'parsing',
    'planning',
    'generating-variants',
    'auditing',
    'exporting',
  ]),
  status: z.enum(['started', 'completed', 'failed']),
  occurredAt: z.string().datetime(),
  message: z.string().min(1).optional(),
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type AuditFinding = z.infer<typeof auditFindingSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type DeckPlan = z.infer<typeof deckPlanSchema>;
export type EditableDeckRequest = z.infer<typeof editableDeckRequestSchema>;
export type EditableDeckResponse = z.infer<typeof editableDeckResponseSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type SlideIR = z.infer<typeof slideIrSchema>;
export type TemplateProfile = z.infer<typeof templateProfileSchema>;
