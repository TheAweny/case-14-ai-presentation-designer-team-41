import { z } from 'zod';

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Agent version must be a semver triple, for example 1.0.0.');

/** Generation parameters passed to the model behind an agent. */
export const agentGenerationSchema = z.object({
  temperature: z.number().min(0).max(2).describe('Sampling temperature.'),
  topP: z.number().min(0).max(1).describe('Nucleus sampling cutoff.'),
  maxOutputTokens: z.number().int().positive().describe('Upper bound on generated tokens.'),
});

/** Schema of registry/agents/<agent-id>/agent.yaml. */
export const agentConfigSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Agent id must be kebab-case.')
    .describe('Directory name of the agent inside registry/agents.'),
  version: semver.describe('Semver version; bump it whenever the instruction changes meaning.'),
  description: z.string().min(1).describe('What the agent is responsible for.'),
  modelId: z.string().min(1).describe('Identifier from configs/models.yaml.'),
  generation: agentGenerationSchema,
  outputSchema: z.string().min(1).describe('Name of the output schema exported by @lct/contracts.'),
  instructionsFile: z.string().min(1).describe('Prompt file next to agent.yaml.'),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentGeneration = z.infer<typeof agentGenerationSchema>;
