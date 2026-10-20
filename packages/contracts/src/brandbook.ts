import { z } from 'zod';

export const brandbookEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  locator: z.string().min(1),
  excerpt: z.string().max(4000),
});

export const brandbookTokenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['color', 'font-family', 'font-size', 'spacing', 'radius', 'grid', 'rule']),
  value: z.union([z.string().max(12000), z.number().finite()]),
  unit: z.enum(['px', 'pt', 'emu', 'percent']).nullable(),
  role: z.string().nullable(),
  scope: z.string().min(1),
  authority: z.enum(['explicit', 'observed', 'inferred']),
  confidence: z.number().min(0).max(1),
  evidence: z.array(brandbookEvidenceSchema).min(1),
});

export const brandbookSourceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  format: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(['parsed', 'partial', 'unsupported']),
  warnings: z.array(z.string()),
});

export const brandbookAssetSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['logo', 'image', 'font', 'example', 'vector']),
  mediaType: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().nonnegative().nullable(),
  height: z.number().nonnegative().nullable(),
  fontFamily: z.string().nullable(),
});

export const brandbookSectionSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  kind: z.enum(['page', 'frame', 'group', 'text', 'rule']),
  name: z.string(),
  locator: z.string().min(1),
  text: z.string().max(50000),
  width: z.number().nonnegative().nullable(),
  height: z.number().nonnegative().nullable(),
  parentId: z.string().nullable(),
});

export const brandbookProfileSchema = z.object({
  schemaVersion: z.literal(1),
  parserVersion: z.string().min(1),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(['ready', 'partial']),
  sources: z.array(brandbookSourceSchema).min(1),
  tokens: z.array(brandbookTokenSchema),
  assets: z.array(brandbookAssetSchema),
  sections: z.array(brandbookSectionSchema),
  warnings: z.array(z.string()),
  coverage: z.object({
    filesTotal: z.number().int().nonnegative(),
    filesParsed: z.number().int().nonnegative(),
    filesUnsupported: z.number().int().nonnegative(),
    needsOcr: z.boolean(),
  }),
});

export const brandbookParseRequestSchema = z.object({
  schemaVersion: z.literal(1),
  path: z.string().min(1).max(4000),
  outputDir: z.string().min(1).max(4000),
});

export const brandbookBindingSchema = z.object({
  schemaVersion: z.literal(1),
  profile: brandbookProfileSchema,
  priority: z.enum(['brandbook', 'template']).default('brandbook'),
  /** Where the profile's asset paths resolve: without it no logo or picture can be placed. */
  assetRoot: z.string().min(1).max(4000).optional(),
});

export type BrandbookProfile = z.infer<typeof brandbookProfileSchema>;
export type BrandbookToken = z.infer<typeof brandbookTokenSchema>;
export type BrandbookAsset = z.infer<typeof brandbookAssetSchema>;
export type BrandbookBinding = z.infer<typeof brandbookBindingSchema>;
export type BrandbookParseRequest = z.infer<typeof brandbookParseRequestSchema>;
