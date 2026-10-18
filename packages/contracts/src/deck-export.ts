import { z } from 'zod';
import { layoutVariantNameSchema, slideIrSchema } from './slide-ir.js';

/**
 * DeckExportRequest and DeckExportResponse — slides written out as files on the template.
 *
 * The slides are whatever the pipeline settled on: laid out by the engine, possibly corrected by
 * accepted fixes. The engine writes them onto the template they follow as native objects, and
 * converts the result to PDF when asked.
 */

export const exportFormatSchema = z.enum(['pptx', 'pdf']);

export const deckExportRequestSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  templatePath: z.string().min(1).describe('Local path of the template the slides follow.'),
  variant: layoutVariantNameSchema,
  slides: z.array(slideIrSchema).min(1),
  outputDir: z.string().min(1).describe('Local directory the files are written to.'),
  /** Validated uploaded raster assets to include in the edited deck. */
  media: z
    .array(
      z.object({
        mediaPart: z.string().regex(/^upload\/[\w.-]+\.(?:png|jpe?g)$/),
        path: z.string().min(1),
      }),
    )
    .max(32)
    .optional(),
  formats: z.array(exportFormatSchema).min(1).optional().describe('Absent: pptx and pdf.'),
  previews: z
    .boolean()
    .optional()
    .describe(
      'Render slide previews from the written file. Absent: true. The edited-deck export ' +
        'sets it per format, so a PPTX download does not pay for PNG rendering.',
    ),
});

export const exportedFileSchema = z.object({
  format: exportFormatSchema,
  path: z.string().min(1).describe('Where the file was written.'),
});

export const deckExportResponseSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  variant: layoutVariantNameSchema,
  files: z.array(exportedFileSchema).min(1),
});

export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type DeckExportRequest = z.infer<typeof deckExportRequestSchema>;
export type DeckExportResponse = z.infer<typeof deckExportResponseSchema>;
