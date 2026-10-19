import { z } from 'zod';
import {
  generationProfileSchema,
  generationRequestSchema,
  compositionNoteSchema,
} from './generation.js';

/** Immutable inputs to a build. Secrets are resolved separately and never stored here. */
export const generationSpecSchema = z.object({
  schemaVersion: z.literal(1),
  request: generationRequestSchema,
  brief: z.string().max(60000),
  profile: generationProfileSchema,
  notes: z.array(compositionNoteSchema).optional(),
  registryHash: z.string().length(64),
  pricingHash: z.string().length(64).optional(),
  modelPolicy: z.array(
    z.object({
      role: z.string(),
      modelId: z.string(),
      connectionId: z.string(),
      endpointHash: z.string().length(64),
      reasoning: z.unknown().optional(),
    }),
  ),
  today: z.string().datetime(),
});
export type GenerationSpec = z.infer<typeof generationSpecSchema>;
