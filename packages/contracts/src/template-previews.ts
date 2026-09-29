import { z } from 'zod';

/**
 * Pictures of every slide of an uploaded template, the way an office suite draws them. The
 * library shows the sample slides a deck is built from with these, photos and device frames
 * included; nothing in them is read back.
 */
export const templatePreviewsRequestSchema = z.object({
  schemaVersion: z.literal(1),
  templatePath: z.string().min(1).describe('The template .pptx, on the engine filesystem.'),
  outputDir: z.string().min(1).describe('Directory the PNG files are written into.'),
  widthPx: z
    .number()
    .int()
    .min(160)
    .max(1920)
    .describe('Width of every picture; the height follows the slide proportions.'),
});

export const templatePreviewsResponseSchema = z.object({
  schemaVersion: z.literal(1),
  previews: z
    .array(z.string().min(1))
    .describe('File names inside the output directory, one per slide, in slide order.'),
});

export type TemplatePreviewsRequest = z.infer<typeof templatePreviewsRequestSchema>;
export type TemplatePreviewsResponse = z.infer<typeof templatePreviewsResponseSchema>;
