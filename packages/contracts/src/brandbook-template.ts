import { z } from 'zod';
import { generationProfileSchema } from './generation.js';
import { designSystemSchema } from './design-system.js';
import { brandbookBindingSchema } from './brandbook.js';

export const brandbookTemplateRequestSchema = z.object({
  schemaVersion: z.literal(1),
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  brandbook: brandbookBindingSchema,
});
export const brandbookTemplateResponseSchema = z.object({
  schemaVersion: z.literal(1),
  templatePath: z.string().min(1),
  profile: generationProfileSchema,
  designSystem: designSystemSchema,
  warnings: z.array(z.string()),
});
export type BrandbookTemplateRequest = z.infer<typeof brandbookTemplateRequestSchema>;
export type BrandbookTemplateResponse = z.infer<typeof brandbookTemplateResponseSchema>;
