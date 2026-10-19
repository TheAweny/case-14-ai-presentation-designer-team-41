import { z } from 'zod';

/** TS-only operational view of the durable provider journal, including failed builds. */
export const generationUsageSchema = z.object({
  httpAttempts: z.number().int().nonnegative(),
  logicalTasks: z.number().int().nonnegative(),
  knownInputTokens: z.number().nonnegative(),
  knownOutputTokens: z.number().nonnegative(),
  unknownUsageAttempts: z.number().int().nonnegative(),
  knownCost: z.number().nonnegative().nullable(),
  unknownCostAttempts: z.number().int().nonnegative(),
  currency: z.string().nullable(),
});
export type GenerationUsage = z.infer<typeof generationUsageSchema>;
