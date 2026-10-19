import { z } from 'zod';

export const operationMetricSchema = z.enum(['generation', 'assistant-response', 'image', 'edit']);
export type OperationMetric = z.infer<typeof operationMetricSchema>;
export const policyMetricSchema = z.enum([
  'generation',
  'assistant-response',
  'image',
  'edit',
  'concurrency',
  'storage',
]);
export type PolicyMetric = z.infer<typeof policyMetricSchema>;
const timezone = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA timezone');
export const accountLimitSchema = z
  .object({
    limit: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    period: z.enum(['lifetime', 'day', 'month']).default('lifetime'),
    timezone: timezone.default('UTC'),
  })
  .strict();
/** Missing inherits an explicitly configured default. Null explicitly disables that limit. */
export const accountPolicySchema = z
  .object({
    generation: accountLimitSchema.nullable().optional(),
    'assistant-response': accountLimitSchema.nullable().optional(),
    image: accountLimitSchema.nullable().optional(),
    edit: accountLimitSchema.nullable().optional(),
    concurrency: accountLimitSchema.nullable().optional(),
    storage: accountLimitSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (policy) =>
      [policy.concurrency, policy.storage].every((row) => !row || row.period === 'lifetime'),
    'Storage and concurrency have no reset period',
  );
export type AccountPolicy = z.infer<typeof accountPolicySchema>;
export type AccountLimit = z.infer<typeof accountLimitSchema>;
export const accountUsageViewSchema = z.object({
  defaults: accountPolicySchema,
  override: accountPolicySchema,
  effective: accountPolicySchema,
  storageBytes: z.number().nonnegative(),
  metrics: z.array(
    z.object({
      metric: policyMetricSchema,
      limit: accountLimitSchema.nullable(),
      start: z.string(),
      end: z.string().nullable(),
      completed: z.number(),
      active: z.number(),
    }),
  ),
});
export type AccountUsageView = z.infer<typeof accountUsageViewSchema>;
