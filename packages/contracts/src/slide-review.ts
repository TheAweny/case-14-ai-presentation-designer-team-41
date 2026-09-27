import { z } from 'zod';

/**
 * SlideReview — a model's answers to the content validation questions about one slide.
 *
 * The case phrases every question so that "yes" is the good answer. A model states its verdict,
 * how sure it is and what on the slide made it say so; a "no" becomes an AuditFinding with that
 * evidence and confidence, and the suggestion, when there is one, is what the user may apply.
 * Nothing here changes a deck by itself.
 */

export const reviewVerdictSchema = z.enum(['yes', 'no', 'unsure']);

export const reviewAnswerSchema = z.object({
  checkId: z.string().min(1).describe('Id of the contextual check the answer is to.'),
  verdict: reviewVerdictSchema,
  confidence: z.number().min(0).max(1).describe('How sure the model is of the verdict.'),
  evidence: z
    .string()
    .describe('The text on the slide the verdict rests on, quoted. Empty for a plain yes.'),
  suggestion: z
    .string()
    .describe('For a "no": what to write or change instead, in one sentence. Empty otherwise.'),
});

export const slideReviewSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  slideId: z.string().min(1),
  answers: z.array(reviewAnswerSchema).min(1).describe('One per question asked.'),
});

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;
export type SlideReview = z.infer<typeof slideReviewSchema>;
