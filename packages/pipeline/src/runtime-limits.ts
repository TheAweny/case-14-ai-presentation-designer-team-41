import { join } from 'node:path';
import { loadAgent, type LoadedAgent } from '@lct/registry';
import type { TextProvider } from './generation/provider.js';

export interface RuntimeLimits {
  readonly modelConcurrency: number;
  readonly generationConcurrency: number;
  readonly generationDeadlineMs: number;
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${key}: требуется целое число от ${min} до ${max}.`);
  return value;
}

/** Deployment limits; invalid configuration fails instead of silently increasing a quota. */
export function readRuntimeLimits(env: NodeJS.ProcessEnv = process.env): RuntimeLimits {
  return {
    modelConcurrency: integer(env, 'MODEL_MAX_CONCURRENCY', 8, 1, 64),
    generationConcurrency: integer(env, 'GENERATION_CONCURRENCY', 3, 1, 6),
    // 270 s by default: thirty seconds stay for the request, the queue and the download.
    generationDeadlineMs: integer(env, 'GENERATION_DEADLINE_MS', 270_000, 60_000, 290_000),
  };
}

export interface RuntimeContext {
  readonly limits: RuntimeLimits;
  readonly deadlineAt?: number;
  readonly contentDeadlineAt?: number;
  readonly modelConcurrencyNow?: number;
  readonly researchCallsRemaining?: number;
  readonly webCallsRemaining?: Readonly<Record<string, number>>;
  readonly toolStepsRemaining?: number;
  readonly imagesAvailable?: boolean;
  readonly searchAvailable?: boolean;
}

/** Registry text carries the policy; runtime facts are data, never user instructions. */
export function runtimeInstructions(agent: LoadedAgent, context: RuntimeContext): string {
  const now = Date.now();
  return `${agent.instructions.trim()}\n\n<runtime-state>\n${JSON.stringify({
    runtime: {
      ...context,
      ...(context.deadlineAt === undefined
        ? {}
        : { remainingMs: Math.max(0, context.deadlineAt - now) }),
      ...(context.contentDeadlineAt === undefined
        ? {}
        : { contentRemainingMs: Math.max(0, context.contentDeadlineAt - now) }),
    },
  })}\n</runtime-state>`;
}

export function loadRuntimeAgent(registryDir: string): Promise<LoadedAgent> {
  return loadAgent(join(registryDir, 'runtime-context'));
}

/** Recompute remaining time on every dispatch, including repairs. */
export function withRuntimeLimits(
  provider: TextProvider,
  agent: LoadedAgent,
  context: () => RuntimeContext,
): TextProvider {
  return {
    model: provider.model,
    get calls() {
      return provider.calls;
    },
    setAgentGeneration: (role, generation) => provider.setAgentGeneration?.(role, generation),
    generate: (role, instructions, input, schema, signal) =>
      provider.generate(
        role,
        `${instructions}\n\n${runtimeInstructions(agent, context())}`,
        input,
        schema,
        signal,
      ),
  };
}
