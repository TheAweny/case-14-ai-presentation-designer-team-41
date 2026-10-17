import { z } from 'zod';
import type { AgentGeneration, ReasoningEffort } from '@lct/contracts';
import { reasoningRequestFields, samplingAllowed } from '../models/reasoning.js';

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
  /** Slots to take requests from; the process-wide pool by default. */
  limiter?: RequestLimiter;
  /** Headers the server asks for besides the key, such as a gateway's `Project-ID`. */
  headers?: Readonly<Record<string, string>>;
  /** Off only when the person switched thinking off for a model that can answer both ways. */
  thinking?: boolean | null;
  /** Depth of thinking for models that take `reasoning_effort`, as the person picked it. */
  reasoningEffort?: ReasoningEffort | null;
  /**
   * The shared prompts from the registry that carry the JSON Schema of an answer in the
   * instructions and ask once to repair an answer that misses it: a model that ignores
   * structured output still answers in shape. Without them only `response_format` holds it.
   */
  answerFormat?: { readonly format: string; readonly repair: string };
}

/** What is wrong with an answer, one problem a line, for the request to repair it. */
function problemsOf(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 20)
      .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
  }
  return `- ${error instanceof Error ? error.message : String(error)}`;
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

/**
 * Request slots, first come first served. A 429 means the provider is over its quota: the pool
 * halves and holds every new request for as long as the provider asked to wait, so the three
 * variants stop knocking together. Each run of answers as long as the pool wins a slot back, up
 * to the configured ceiling.
 */
export class RequestLimiter {
  private active = 0;
  private limit: number;
  private successes = 0;
  private pausedUntil = 0;
  private wake: ReturnType<typeof setTimeout> | undefined;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly ceiling = MAX_CONCURRENT) {
    this.limit = ceiling;
  }

  /** Requests the pool lets through at once right now. */
  get capacity(): number {
    return this.limit;
  }

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
      if (this.waiting.length === 0 && this.open()) grant();
      else {
        this.waiting.push(grant);
        signal.addEventListener('abort', abort, { once: true });
        this.pump();
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.pump();
    };
  }

  /**
   * The provider refused for load and asked to wait `ms`. Requests in flight when it did all come
   * back refused together, so the pool halves once per pause, not once per refusal.
   */
  throttle(ms: number): void {
    const now = Date.now();
    if (now >= this.pausedUntil) this.limit = Math.max(1, Math.floor(this.limit / 2));
    this.successes = 0;
    this.pausedUntil = Math.max(this.pausedUntil, now + ms);
    this.pump();
  }

  /** An answer came back. After as many in a row as the pool holds, it grows by one. */
  succeeded(): void {
    if (this.limit >= this.ceiling || ++this.successes < this.limit) return;
    this.successes = 0;
    this.limit++;
    this.pump();
  }

  private open(): boolean {
    return this.active < this.limit && Date.now() >= this.pausedUntil;
  }

  private pump(): void {
    while (this.waiting.length > 0 && this.open()) this.waiting.shift()?.();
    const pause = this.pausedUntil - Date.now();
    if (this.waiting.length > 0 && pause > 0 && !this.wake) {
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.pump();
      }, pause);
    }
  }
}

// I share the HTTP slots across all runs and variants in this process, not per deck.
const requests = new RequestLimiter();

/**
 * Take one of the process-wide model request slots; the answer releases it. The chat shares them
 * with the generation, so a chat turn waits behind a deck rather than overloading the provider.
 */
export function acquireModelSlot(signal: AbortSignal): Promise<() => void> {
  return requests.acquire(signal);
}

/** The provider refused a chat turn for load: the whole process slows down, not only the chat. */
export function throttleModelSlots(ms: number): void {
  requests.throttle(ms);
}

/** Answers that mean "busy, ask again", not "wrong request". */
export const BUSY_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

/**
 * Times a call is asked again after a busy answer. The waits grow 1, 2, 4, 8, 16 s, about half a
 * minute in all, which the run's own deadline still covers.
 */
export const BUSY_RETRIES = 5;
const MAX_BACKOFF_MS = 16_000;
/** The longest wait a Retry-After header may impose; a longer one is the run's deadline's call. */
const MAX_RETRY_AFTER_MS = 30_000;

/** Retry-After as milliseconds: either seconds or an HTTP date. */
function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? 0 : Math.max(0, at - Date.now());
}

/**
 * The wait before asking again after the `retry`-th busy answer: an exponential step with jitter,
 * so three variants refused at once do not come back at once, and never less than the provider
 * asked for.
 */
export function retryDelay(retry: number, retryAfter: string | null, random = Math.random): number {
  const step = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** retry);
  const jittered = step / 2 + (random() * step) / 2;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(retryAfterMs(retryAfter), jittered));
}

export function backoff(ms: number, signal: AbortSignal): Promise<void> {
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
  private readonly limiter: RequestLimiter;

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
    this.limiter = options.limiter ?? requests;
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
    const answerFormat = this.options.answerFormat;
    const reasoning = reasoningRequestFields(
      this.model,
      this.options.reasoningEffort,
      this.options.thinking,
    );
    const system = answerFormat
      ? `${instructions}\n\n${answerFormat.format.replace('{{schema}}', JSON.stringify(outputSchema))}`
      : instructions;
    // An answer that missed the schema, with what is wrong, while it is being repaired. A model
    // is asked to repair once; after that a miss is drawn again from scratch.
    let repair: { answer: string; problems: string } | null = null;
    let repaired = false;
    // Two budgets: `attempt` counts draws that came back unusable (empty, truncated, off-schema,
    // timed out, dropped) and grows the token budget; `busy` counts refusals for load, which say
    // nothing about the answer and only cost a wait.
    let attempt = 0;
    let busy = 0;
    for (;;) {
      signal.throwIfAborted();
      const release = await this.limiter.acquire(signal);
      const started = Date.now();
      let wait = 500;
      try {
        signal.throwIfAborted();
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            ...this.options.headers,
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
            ...(samplingAllowed(this.model, reasoning)
              ? { temperature: generation?.temperature ?? 0.35, top_p: generation?.topP ?? 1 }
              : {}),
            max_tokens: (generation?.maxOutputTokens ?? 3600) * (attempt + 1),
            ...reasoning,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: agent.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'output',
                strict: true,
                schema: outputSchema,
              },
            },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: JSON.stringify(input) },
              ...(repair && answerFormat
                ? [
                    { role: 'assistant', content: repair.answer },
                    {
                      role: 'user',
                      content: answerFormat.repair.replace('{{problems}}', repair.problems),
                    },
                  ]
                : []),
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (!BUSY_STATUSES.has(response.status) || busy >= BUSY_RETRIES) {
            throw new Error(
              `Model API HTTP ${response.status} for ${this.model}` +
                (busy ? ` after ${busy} retries` : '') +
                '; no alternate model was used.',
            );
          }
          wait = retryDelay(busy++, response.headers.get('retry-after'));
          // 502 is a gateway hiccup; 429 and 503 say the provider is overloaded, so every
          // request in the process backs off, not only this one.
          if (response.status !== 502) this.limiter.throttle(wait);
        } else {
          const data = (await response.json()) as Completion;
          const choice = data.choices?.[0];
          if (!choice?.message?.content || choice.finish_reason === 'length') {
            if (attempt++ < 2) continue;
            throw new Error('Model returned empty or truncated JSON.');
          }
          let result: T;
          try {
            result = parseModelJson(choice.message.content, schema);
          } catch (error) {
            // Malformed or off-schema JSON: told what is wrong, a model usually fixes it; a second
            // miss is a sampling accident, and a fresh draw follows.
            if (attempt++ >= 2) throw error;
            repair =
              answerFormat && !repaired
                ? { answer: choice.message.content.slice(0, 20000), problems: problemsOf(error) }
                : null;
            if (repair) repaired = true;
            continue;
          }
          this.limiter.succeeded();
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
        // One slow answer or dropped connection must not sink the deck: a request that hit its
        // own time limit or lost the network (fetch rejects with a TypeError) is retried, while
        // cancellation of the whole run still stops at once.
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        const dropped = error instanceof TypeError;
        if (!(timedOut || dropped) || signal.aborted || attempt++ >= 2) throw error;
      } finally {
        release();
      }
      await backoff(wait, signal);
    }
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
