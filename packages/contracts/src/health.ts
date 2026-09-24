import { z } from 'zod';

/**
 * HealthCheck — the answer of `/health`, on both the API and the engine.
 *
 * It began as a placeholder that proved the Zod -> JSON Schema -> Pydantic chain worked end to
 * end. The real contracts have landed since, and this one stayed because the API and the engine
 * client both parse a liveness response with it and it is the one contract the two sides can
 * exchange before a run exists.
 */
export const healthCheckSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']).describe('Current state of the component.'),
  service: z.string().min(1).describe('Name of the component that answered.'),
  version: z.string().min(1).describe('Semantic version of the component.'),
  uptimeSeconds: z.number().nonnegative().describe('Seconds since the component started.'),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
