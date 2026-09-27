import { z } from 'zod';

/**
 * ModelCatalog — schema of configs/models.yaml, the models a run may bind to its roles.
 *
 * The case allows open-weight models only, under Apache 2.0 or MIT, of at most 35B parameters,
 * and a run has to be traceable to the exact weights that produced it. The schema states those
 * rules so a catalogue that breaks them fails to load rather than failing a review.
 */

/** Largest model the case allows, in billions of parameters. */
export const MAX_MODEL_SIZE_B = 35;

export const modelLicenseSchema = z.enum(['Apache-2.0', 'MIT']);

export const modelTypeSchema = z.enum(['llm', 'vlm', 'text-to-image']);

/**
 * Who serves the model. `openai-compatible` is any runtime with the OpenAI chat API (vLLM,
 * llama.cpp, a hosted provider); `fake` answers from recorded responses and needs no network.
 */
export const modelProviderSchema = z.enum(['openai-compatible', 'fake']);

export const modelEntrySchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Model id must be kebab-case.')
    .describe('Identifier run configs and agents refer to.'),
  repo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Repository must be owner/name on Hugging Face.')
    .describe('Hugging Face repository of the weights.'),
  revision: z
    .string()
    .min(1)
    .refine(
      (value) => value !== 'main' && value !== 'master',
      'Pin a commit or a tag, not a branch.',
    )
    .describe('Commit or tag of the weights, so a run can be traced back to them.'),
  license: modelLicenseSchema.describe('License of the weights. The case allows these two only.'),
  sizeB: z
    .number()
    .positive()
    .max(MAX_MODEL_SIZE_B)
    .describe('Parameter count in billions. The case caps it at 35.'),
  type: modelTypeSchema,
  provider: modelProviderSchema,
  baseUrlEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'An environment variable name.')
    .describe('Variable holding the base URL of the runtime, ending in /v1.'),
  servedName: z
    .string()
    .min(1)
    .optional()
    .describe('Name the runtime serves the model under. Absent: the repository name.'),
  extraBody: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Fields added to every chat request, such as switching a model's thinking off."),
});

export const modelCatalogSchema = z
  .object({ models: z.array(modelEntrySchema).min(1) })
  .refine(
    (catalog) => new Set(catalog.models.map((model) => model.id)).size === catalog.models.length,
    'Model ids must be unique.',
  );

export type ModelLicense = z.infer<typeof modelLicenseSchema>;
export type ModelType = z.infer<typeof modelTypeSchema>;
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
