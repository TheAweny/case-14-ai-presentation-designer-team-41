import { z } from 'zod';

/** Chat/model contracts only: no engine boundary and no Python code generation. */
const fileIdSchema = z.string().uuid();

export const materialResearchInputSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    fileIds: z.array(fileIdSchema).min(1).max(3),
    offsets: z.record(fileIdSchema, z.number().int().nonnegative().max(1_000_000)).optional(),
  })
  .superRefine((value, ctx) => {
    const fileIds = new Set(value.fileIds);
    for (const fileId of Object.keys(value.offsets ?? {})) {
      if (!fileIds.has(fileId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['offsets', fileId],
          message: 'Offset keys must be file ids from this request.',
        });
      }
    }
  });

export const materialResearchSourceSchema = z.object({
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(300),
  text: z.string().max(12000),
  offset: z.number().int().nonnegative().max(1_000_000).optional(),
  truncated: z.boolean(),
});
export type MaterialResearchSource = z.infer<typeof materialResearchSourceSchema>;

/** The model selects excerpts; the server supplies attribution and checks every quote. */
export const materialResearchAnswerSchema = z.object({
  excerpts: z
    .array(z.object({ sourceId: z.string().uuid(), quote: z.string().min(1).max(1000) }))
    .max(3),
  openQuestions: z.array(z.string().trim().min(1).max(300)).max(3),
});

export const materialResearchResultSchema = z.object({
  outputTruncated: z.boolean(),
  summary: z.string().max(3002),
  evidence: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        name: z.string().max(300),
        quote: z.string().min(1).max(1000),
        start: z.number().int().nonnegative(),
        support: z.literal('unverified'),
      }),
    )
    .max(3),
  openQuestions: z.array(z.string().min(1).max(300)).max(5),
  coverage: z
    .array(
      z.object({
        sourceId: z.string().uuid(),
        offset: z.number().int().nonnegative().optional(),
        readChars: z.number().int().nonnegative(),
        truncated: z.boolean(),
        nextOffset: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .max(3),
  manifest: z.object({
    agentId: z.string(),
    agentVersion: z.string(),
    instructionsSha256: z.string().length(64),
    model: z.string(),
    modelRevision: z.string().nullable(),
    seed: z.number().int().nullable(),
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
  }),
});
export type MaterialResearchResult = z.infer<typeof materialResearchResultSchema>;
