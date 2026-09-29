import { z } from 'zod';
import type { AgentGeneration } from '@lct/contracts';

export interface TextProvider {
  readonly model: string;
  generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T>;
}
/**
 * The JSON object of a model answer. Models that ignore the JSON mode wrap it: a reasoning block,
 * a Markdown fence, a sentence before or after. The object is the text from the first `{` to the
 * last `}` once the reasoning is dropped; anything else is not an answer.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): T {
  const answer = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end < start) throw new SyntaxError('The model answer holds no JSON object.');
  return schema.parse(JSON.parse(answer.slice(start, end + 1)));
}
interface Options {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  seed?: number;
}
interface Completion {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Model requests at once for the whole process. Three variants of a deck are written in parallel,
 * so three slots made them three times slower; eight stays under the ten parallel requests Yandex
 * AI Studio allows, and MODEL_MAX_CONCURRENCY tunes it for another provider.
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env.MODEL_MAX_CONCURRENCY) || 8);

class RequestLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  async acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (this.active < MAX_CONCURRENT) grant();
      else {
        this.waiting.push(grant);
        signal.addEventListener('abort', abort, { once: true });
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }
}

// I share the HTTP slots across all runs and variants in this process, not per deck.
const requests = new RequestLimiter();

function backoff(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class OpenAICompatibleProvider implements TextProvider {
  private readonly generation = new Map<string, AgentGeneration>();

  setAgentGeneration(agent: string, generation: AgentGeneration): void {
    this.generation.set(agent, generation);
  }
  readonly model: string;
  readonly calls: {
    agent: string;
    ms: number;
    inputTokens: number;
    outputTokens: number;
    provider: string;
  }[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly provider: string;

  constructor(private readonly options: Options) {
    // A key is optional: local runtimes such as Ollama take none. Address and model are not.
    if (!options.baseUrl.trim()) throw new Error('The model server address is required.');
    if (!options.model.trim()) throw new Error('The model name is required.');
    const url = new URL(options.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'The model server address must be an HTTP(S) base URL without credentials or query.',
      );
    }
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.provider = url.hostname;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const outputSchema = z.toJSONSchema(schema, { target: 'draft-7' });
    const generation = this.generation.get(agent);
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const release = await requests.acquire(signal);
      const started = Date.now();
      let retryDelay = 500;
      try {
        signal.throwIfAborted();
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            ...(this.options.apiKey.trim()
              ? { Authorization: `Bearer ${this.options.apiKey}` }
              : {}),
            'Content-Type': 'application/json',
          },
          // A redirect would carry the key to wherever the server points; refuse it instead.
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]),
          body: JSON.stringify({
            model: this.model,
            seed: this.options.seed ?? 42,
            temperature: generation?.temperature ?? 0.35,
            top_p: generation?.topP ?? 1,
            max_tokens: (generation?.maxOutputTokens ?? 3600) * (attempt + 1),
            chat_template_kwargs: { enable_thinking: false },
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: agent.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'output',
                strict: true,
                schema: outputSchema,
              },
            },
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: JSON.stringify(input) },
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if ([429, 502, 503].includes(response.status) && attempt < 2) {
            const retryAfter = Number(response.headers.get('retry-after'));
            retryDelay = Math.min(8000, Math.max(1500 * (attempt + 1), retryAfter * 1000 || 0));
          } else {
            throw new Error(
              `Model API HTTP ${response.status} for ${this.model}; no alternate model was used.`,
            );
          }
        } else {
          const data = (await response.json()) as Completion;
          const choice = data.choices?.[0];
          if (!choice?.message?.content || choice.finish_reason === 'length') {
            if (attempt < 2) continue;
            throw new Error('Model returned empty or truncated JSON.');
          }
          let result: T;
          try {
            result = parseModelJson(choice.message.content, schema);
          } catch (error) {
            // Malformed or off-schema JSON is a sampling accident; one more draw usually fixes it.
            if (attempt < 2) continue;
            throw error;
          }
          this.calls.push({
            agent,
            ms: Date.now() - started,
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            provider: this.provider,
          });
          return result;
        }
      } catch (error) {
        // One slow answer must not sink the deck: a request that hit its own time limit is
        // retried, while cancellation of the whole run still stops at once.
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        if (!timedOut || signal.aborted || attempt >= 2) throw error;
      } finally {
        release();
      }
      await backoff(retryDelay, signal);
    }
    throw new Error('Model retry budget exhausted.');
  }
}

/** Routes each pipeline role to its saved OpenAI-compatible connection. */
export class RoutedTextProvider implements TextProvider {
  readonly model: string;
  constructor(
    private readonly fallback: OpenAICompatibleProvider,
    private readonly providers: ReadonlyMap<string, OpenAICompatibleProvider>,
  ) {
    this.model = fallback.model;
  }
  setAgentGeneration(agent: string, generation: AgentGeneration): void {
    (this.providers.get(agent) ?? this.fallback).setAgentGeneration(agent, generation);
  }
  generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    return (this.providers.get(agent) ?? this.fallback).generate(
      agent,
      instructions,
      input,
      schema,
      signal,
    );
  }
}
