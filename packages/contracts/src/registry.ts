import type { ZodType } from 'zod';
import { healthCheckSchema } from './health.js';
import { runConfigSchema } from './run-config.js';
import { agentConfigSchema } from './agent-config.js';

/**
 * Every schema that gets exported to JSON Schema and, from there, to Pydantic.
 * Adding a schema here is what makes it visible to the Python engine.
 */
export const contractRegistry = {
  HealthCheck: healthCheckSchema,
  RunConfig: runConfigSchema,
  AgentConfig: agentConfigSchema,
} satisfies Record<string, ZodType>;

export type ContractName = keyof typeof contractRegistry;
