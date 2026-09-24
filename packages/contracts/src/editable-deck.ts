import { z } from 'zod';

const editableDeckSlideSchema = z.object({
  slideId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

/** Narrow local API contract used to verify native PPTX generation end to end. */
export const editableDeckRequestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  runId: z.string().min(1),
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  slides: z.array(editableDeckSlideSchema).min(1).max(15),
});

export const editableDeckResponseSchema = z.object({
  schemaVersion: z.literal(1),
  outputPath: z.string().min(1),
  designSystem: z.record(z.string(), z.unknown()),
  slideCount: z.number().int().positive(),
});

export type EditableDeckRequest = z.infer<typeof editableDeckRequestSchema>;
export type EditableDeckResponse = z.infer<typeof editableDeckResponseSchema>;
