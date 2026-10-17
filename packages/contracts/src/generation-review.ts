import { z } from 'zod';
import { compositionCritiqueSchema } from './generation.js';

const reviewCountsSchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});

/** Final checks of one immutable export; never inferred from a partial audit. */
export const finalReviewSchema = z.object({
  schemaVersion: z.literal(1),
  contentRevision: z.number().int().positive(),
  contentHash: z.string().length(64),
  status: z.enum(['complete', 'requires-review', 'unknown']),
  deterministic: reviewCountsSchema.nullable(),
  contextual: reviewCountsSchema.nullable(),
  coverage: z.object({
    total: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    missing: z.array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        claimIndex: z.number().int().nonnegative(),
        text: z.string(),
      }),
    ),
  }),
  issues: compositionCritiqueSchema.shape.issues,
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});
export type FinalReview = z.infer<typeof finalReviewSchema>;
