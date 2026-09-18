import { z } from 'zod';

/**
 * Temporary placeholder schema. It exists so the Zod -> JSON Schema -> Pydantic chain
 * is verifiable end to end before the real contracts land. Replace it with the
 * template-profile, deck-plan and slide-IR schemas and drop this file.
 */
export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']).describe('Current state of the component.'),
  service: z.string().min(1).describe('Name of the component that answered.'),
  version: z.string().min(1).describe('Semantic version of the component.'),
  uptimeSeconds: z.number().nonnegative().describe('Seconds since the component started.'),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
