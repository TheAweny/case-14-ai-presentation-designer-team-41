import { createHash } from 'node:crypto';
import { contractRegistry, type ContractName } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import type { ZodType } from 'zod';

/**
 * A model call as the pipeline sees it: an agent from the registry, the JSON it is given, and
 * the seed of the run. The answer is JSON validated against the agent's output schema, so a
 * step never handles text a model made up the shape of.
 */
export interface ModelRequest {
  readonly agent: LoadedAgent;
  readonly input: unknown;
  readonly seed: number;
  /** Pictures the model looks at, as data URLs, for vision agents. */
  readonly images?: readonly string[];
}

/** What serves an agent: a real runtime, or recorded answers. */
export interface ModelProvider {
  readonly name: string;
  /** Raw text of the model's answer. Parsing and validation are the caller's. */
  complete(request: ModelRequest, feedback?: string): Promise<string>;
}

/** The answer did not become valid JSON of the right shape, even after one retry. */
export class InvalidModelAnswerError extends Error {
  constructor(
    readonly agentId: string,
    readonly answer: string,
    reason: string,
  ) {
    super(`Agent ${agentId} answered with invalid output: ${reason}`);
    this.name = 'InvalidModelAnswerError';
  }
}

/** Key a recording is stored under: the agent version, its prompt, the input and the seed. */
export function requestKey(request: ModelRequest): string {
  const hash = createHash('sha256');
  hash.update(request.agent.config.id);
  hash.update(request.agent.config.version);
  hash.update(request.agent.instructions);
  hash.update(JSON.stringify(request.input));
  hash.update(String(request.seed));
  for (const image of request.images ?? []) {
    hash.update(image);
  }
  return hash.digest('hex').slice(0, 32);
}

/**
 * Pulls the JSON object out of a model's answer. Reasoning models may think aloud in a
 * <think> block and chat models like to fence JSON in markdown; neither is part of the answer.
 */
export function extractJson(answer: string): unknown {
  const withoutThinking = answer.replace(/<think>[\s\S]*?<\/think>/g, '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(withoutThinking);
  const body = (fenced?.[1] ?? withoutThinking).trim();
  const start = body.search(/[[{]/);
  if (start < 0) {
    throw new SyntaxError('No JSON object in the answer.');
  }
  const open = body[start];
  const end = body.lastIndexOf(open === '{' ? '}' : ']');
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function outputSchema(agent: LoadedAgent): ZodType {
  const name = agent.config.outputSchema as ContractName;
  const schema = contractRegistry[name] as ZodType | undefined;
  if (schema === undefined) {
    throw new Error(`Agent ${agent.config.id} names an unknown output schema "${name}".`);
  }
  return schema;
}

/**
 * Runs one agent and returns its validated answer. An answer that is not valid JSON of the
 * agent's output schema is sent back once with the validation error, then given up on: a bounded
 * retry keeps a run inside its time budget and a broken answer out of the deck.
 */
export async function runAgent<T = unknown>(
  provider: ModelProvider,
  request: ModelRequest,
): Promise<T> {
  const schema = outputSchema(request.agent);
  let feedback: string | undefined;
  let answer = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    answer = await provider.complete(request, feedback);
    try {
      const parsed = schema.safeParse(extractJson(answer));
      if (parsed.success) {
        return parsed.data as T;
      }
      feedback = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
    }
  }
  throw new InvalidModelAnswerError(request.agent.config.id, answer, feedback ?? 'unknown');
}
