import { z } from 'zod';
import { slideIrSchema } from './slide-ir.js';

/**
 * Reading a finished .pptx back as SlideIR, the way it looks: every slide with what its layout and
 * master put on it, text in the size, colour and typeface it is drawn in, the picture behind it
 * and the outline of every shape. The editor opens a generated deck from this, so what it draws
 * matches the file and its PDF. Only the engine reads .pptx; the web and the audit get SlideIR.
 */
export const deckImportRequestSchema = z.object({
  schemaVersion: z.literal(1),
  pptxPath: z.string().min(1).describe('The .pptx to read, on the engine filesystem.'),
  mediaDir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory the pictures the slides draw are written into, each under the file name of its ' +
        'part, so a server can hand them out by that name. Absent: nothing is written.',
    ),
});

export const deckImportResponseSchema = z.object({
  schemaVersion: z.literal(1),
  slides: z
    .array(slideIrSchema)
    .describe('Slides in presentation order. Colours that match the palette name its role.'),
});

export type DeckImportRequest = z.infer<typeof deckImportRequestSchema>;
export type DeckImportResponse = z.infer<typeof deckImportResponseSchema>;
