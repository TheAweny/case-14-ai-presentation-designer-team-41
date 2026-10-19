import { z } from 'zod';
import { layoutVariantNameSchema, slideIrSchema } from './slide-ir.js';

/**
 * A durable editor snapshot: the whole deck at one revision, plus the uploaded pictures it
 * names. Binaries are not in this payload. `media` is only references the server already stored.
 *
 * `expectedRevision` is the revision the client last observed. Two saves that name the same
 * revision cannot both become the head. The same `idempotencyKey` returns the first outcome
 * again, so a repeated request does not create a second revision.
 */

export const EDITOR_SNAPSHOT_LIMITS = {
  maxSlides: 80,
  maxSlideJsonBytes: 1_500_000,
  maxMediaFiles: 32,
  maxMediaBytes: 1024 * 1024,
  maxMediaTotalBytes: 3 * 1024 * 1024,
} as const;

const deckIdSchema = z
  .string()
  .regex(/^run-[0-9a-f-]{36}$/i)
  .describe('The finished deck this snapshot belongs to.');

export const editorMediaRefSchema = z.object({
  mediaPart: z.string().regex(/^upload\/[\w.-]+\.(?:png|jpe?g)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().positive().max(EDITOR_SNAPSHOT_LIMITS.maxMediaBytes),
  contentType: z.enum(['image/png', 'image/jpeg']),
});

export const editorSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  deckId: deckIdSchema,
  revision: z.number().int().positive(),
  base: z.string().min(1).max(80).describe('Fingerprint of the deck the edits started from.'),
  savedAt: z.string().datetime(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  slides: z.array(slideIrSchema).min(1).max(EDITOR_SNAPSHOT_LIMITS.maxSlides),
  media: z.array(editorMediaRefSchema).max(EDITOR_SNAPSHOT_LIMITS.maxMediaFiles),
});

export const editorSnapshotLoadSchema = z.object({
  schemaVersion: z.literal(1),
  snapshot: editorSnapshotSchema.nullable(),
});

const slidePayload = z
  .array(slideIrSchema)
  .min(1)
  .max(EDITOR_SNAPSHOT_LIMITS.maxSlides)
  .superRefine((slides, ctx) => {
    const bytes = new TextEncoder().encode(JSON.stringify(slides)).length;
    if (bytes > EDITOR_SNAPSHOT_LIMITS.maxSlideJsonBytes) {
      ctx.addIssue({
        code: 'custom',
        message: `Snapshot slides exceed ${EDITOR_SNAPSHOT_LIMITS.maxSlideJsonBytes} bytes.`,
      });
    }
  });

export const editorSnapshotSaveRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .describe('0 when the deck has no snapshot yet. Otherwise the revision last read or saved.'),
    idempotencyKey: z.string().uuid(),
    base: z.string().min(1).max(80),
    slides: slidePayload,
    media: z.array(editorMediaRefSchema).max(EDITOR_SNAPSHOT_LIMITS.maxMediaFiles),
  })
  .superRefine((request, ctx) => {
    const names = new Set<string>();
    for (const ref of request.media) {
      if (names.has(ref.mediaPart)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate media reference: ${ref.mediaPart}` });
      }
      names.add(ref.mediaPart);
    }
    for (const slide of request.slides) {
      for (const element of slide.elements) {
        if (
          element.kind === 'image' &&
          element.mediaPart.startsWith('upload/') &&
          !names.has(element.mediaPart)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: `Missing media reference: ${element.mediaPart}`,
          });
        }
      }
    }
    const total = request.media.reduce((sum, item) => sum + item.byteSize, 0);
    if (total > EDITOR_SNAPSHOT_LIMITS.maxMediaTotalBytes) {
      ctx.addIssue({
        code: 'custom',
        message: `Snapshot media exceed ${EDITOR_SNAPSHOT_LIMITS.maxMediaTotalBytes} bytes.`,
      });
    }
  });

export const editorConflictSchema = z.object({
  schemaVersion: z.literal(1),
  conflictId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  server: editorSnapshotSchema,
  /** The copy that was rejected. It stays stored until the user chooses what to keep. */
  rejected: z.object({
    base: z.string().min(1).max(80),
    slides: z.array(slideIrSchema).min(1),
    media: z.array(editorMediaRefSchema),
  }),
});

export const editorSnapshotSaveResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('saved'),
    snapshot: editorSnapshotSchema,
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('conflict'),
    conflict: editorConflictSchema,
  }),
]);

export const editorMediaPutRequestSchema = z.object({
  schemaVersion: z.literal(1),
  mediaPart: z.string().regex(/^upload\/[\w.-]+\.(?:png|jpe?g)$/),
  dataUrl: z.string().max(1_398_136),
});

export const editorMediaPutResponseSchema = z.object({
  schemaVersion: z.literal(1),
  media: editorMediaRefSchema,
});

export const editorRevisionExportRequestSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.enum(['pptx', 'pdf', 'png', 'html']),
  variant: layoutVariantNameSchema.optional(),
  slideIds: z.array(z.string().min(1)).max(EDITOR_SNAPSHOT_LIMITS.maxSlides).optional(),
});

export const editorRevisionExportResponseSchema = z.object({
  schemaVersion: z.literal(1),
  exportId: z.string().uuid(),
  revision: z.number().int().positive(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  previews: z.array(z.string()),
});

export type EditorMediaRef = z.infer<typeof editorMediaRefSchema>;
export type EditorSnapshot = z.infer<typeof editorSnapshotSchema>;
export type EditorSnapshotLoad = z.infer<typeof editorSnapshotLoadSchema>;
export type EditorSnapshotSaveRequest = z.infer<typeof editorSnapshotSaveRequestSchema>;
export type EditorConflict = z.infer<typeof editorConflictSchema>;
export type EditorSnapshotSaveResponse = z.infer<typeof editorSnapshotSaveResponseSchema>;
export type EditorMediaPutRequest = z.infer<typeof editorMediaPutRequestSchema>;
export type EditorMediaPutResponse = z.infer<typeof editorMediaPutResponseSchema>;
export type EditorRevisionExportRequest = z.infer<typeof editorRevisionExportRequestSchema>;
export type EditorRevisionExportResponse = z.infer<typeof editorRevisionExportResponseSchema>;
