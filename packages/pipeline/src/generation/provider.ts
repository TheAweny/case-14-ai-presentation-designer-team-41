import { z } from 'zod';
import type { AgentGeneration, ReasoningCapability, ReasoningEffort } from '@lct/contracts';
import { reasoningRequestFields, samplingAllowed } from '../models/reasoning.js';
import { CompatibleRequests, refusedParameter } from '../models/compatibility.js';
import type { AttemptBudget } from './attempt-budget.js';
import { modelHttpFailure } from '../chat/model-failure.js';

export interface TextProvider {
  readonly model: string;
  readonly calls?: readonly {
    agent: string;
    modelId?: string;
    ms: number;
    inputTokens: number | null;
    outputTokens: number | null;
    provider: string;
  }[];
  setAgentGeneration?(agent: string, generation: AgentGeneration): void;
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
  queueGroup?: string;
  /** Headers the server asks for besides the key, such as a gateway's `Project-ID`. */
  headers?: Readonly<Record<string, string>>;
  /** Thinking is on only when the person switched it on; null leaves it off, as false does. */
  thinking?: boolean | null;
  reasoningEffort?: ReasoningEffort | null;
  reasoning?: ReasoningCapability;
  /**
   * One logical `generate` call, retries included. `running` means the agent was asked, not that
   * a GPU is busy: the limiter's queue is not a separate agent. Events carry no prompt or answer.
   */
  onActivity?: (event: AgentActivity) => void;
  /**
   * The shared prompts from the registry that carry the JSON Schema of an answer in the
   * instructions and ask once to repair an answer that misses it: a model that ignores
   * structured output still answers in shape. Without them only `response_format` holds it.
   */
  answerFormat?: { readonly format: string; readonly repair: string };
  /**
   * Attempts shared by this build. Each retry after a busy answer (429, 502, 503) takes one.
   * Omitted, only the local cap of {@link BUSY_RETRIES} applies, as before.
   */
  attemptBudget?: AttemptBudget;
}

/** A logical agent call. Retries stay on the same id; the event holds no prompt, answer, or key. */
export interface AgentActivity {
  id: string;
  name: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
}

function reportActivity(report: Options['onActivity'], event: AgentActivity): void {
  if (!report) return;
  try {
    report(event);
  } catch {
    // A listener that throws must not change the model answer.
  }
}

/** The call stopped because the caller cancelled it, not because the model refused. */
function cancelledCall(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true;
  return signal.aborted && error === signal.reason;
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
  choices?: {
    message?: { content?: string; reasoning_content?: string; refusal?: string };
    finish_reason?: string;
  }[];
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
  private readonly waiting: { grant: () => void; group: string; tokens: number }[] = [];
  private turn = 0;
  private readonly turns = new Map<string, number>();
  private readonly activeGroups = new Map<string, number>();
  private readonly sent: { at: number; tokens: number }[] = [];

  constructor(
    private readonly ceiling = MAX_CONCURRENT,
    private readonly quota: { rpm?: number; tpm?: number } = {},
  ) {
    this.limit = ceiling;
  }

  /** Requests the pool lets through at once right now. */
  get capacity(): number {
    return this.limit;
  }

  async acquire(signal: AbortSignal, group = 'default', tokens = 0): Promise<() => void> {
    signal.throwIfAborted();
    if (this.quota.tpm !== undefined && tokens > this.quota.tpm)
      throw new Error('Запрос превышает настроенный TPM.');
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', abort);
        this.active++;
        this.turns.set(group, ++this.turn);
        this.activeGroups.set(group, (this.activeGroups.get(group) ?? 0) + 1);
        this.sent.push({ at: Date.now(), tokens });
        resolve();
      };
      const abort = () => {
        const index = this.waiting.findIndex((item) => item.grant === grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal.reason);
      };
      if (this.waiting.length === 0 && this.open(tokens)) grant();
      else {
        this.waiting.push({ grant, group, tokens });
        signal.addEventListener('abort', abort, { once: true });
        this.pump();
      }
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const left = (this.activeGroups.get(group) ?? 1) - 1;
      if (left > 0) this.activeGroups.set(group, left);
      else {
        this.activeGroups.delete(group);
        if (!this.waiting.some((item) => item.group === group)) this.turns.delete(group);
      }
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

  private open(tokens = 0): boolean {
    while (this.sent[0] && this.sent[0].at <= Date.now() - 60_000) this.sent.shift();
    return (
      this.active < this.limit &&
      Date.now() >= this.pausedUntil &&
      (this.quota.rpm === undefined || this.sent.length < this.quota.rpm) &&
      (this.quota.tpm === undefined ||
        this.sent.reduce((sum, item) => sum + item.tokens, 0) + tokens <= this.quota.tpm)
    );
  }

  private pump(): void {
    while (this.waiting.length > 0) {
      let index = -1;
      for (let at = 0; at < this.waiting.length; at++) {
        const candidate = this.waiting[at];
        const current = this.waiting[index];
        if (
          candidate &&
          this.open(candidate.tokens) &&
          (!current ||
            (this.turns.get(candidate.group) ?? 0) < (this.turns.get(current.group) ?? 0))
        )
          index = at;
      }
      if (index < 0) break;
      this.waiting.splice(index, 1)[0]?.grant();
    }
    const pause = Math.max(
      this.pausedUntil - Date.now(),
      (this.quota.rpm !== undefined || this.quota.tpm !== undefined) && this.sent[0]
        ? this.sent[0].at + 60_000 - Date.now()
        : 0,
    );
    if (this.waiting.length === 0 && this.wake) {
      clearTimeout(this.wake);
      this.wake = undefined;
    }
    if (this.waiting.length > 0 && pause > 0 && !this.wake) {
      this.wake = setTimeout(() => {
        this.wake = undefined;
        this.pump();
      }, pause);
    }
  }
}

// I share the HTTP slots across all runs and variants in this process, not per deck.
const configuredQuota = (name: string): number | undefined => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};
const requests = new RequestLimiter(MAX_CONCURRENT, {
  rpm: configuredQuota('MODEL_RPM'),
  tpm: configuredQuota('MODEL_TPM'),
});

/**
 * Take one of the process-wide model request slots; the answer releases it. The chat shares them
 * with the generation, so a chat turn waits behind a deck rather than overloading the provider.
 */
export function acquireModelSlot(signal: AbortSignal, group = 'chat'): Promise<() => void> {
  return requests.acquire(signal, group);
}

/** The provider refused a chat turn for load: the whole process slows down, not only the chat. */
export function throttleModelSlots(ms: number): void {
  requests.throttle(ms);
}

/** The process-wide pool. A vision call uses it unless a test passes its own limiter. */
export function sharedModelLimiter(): RequestLimiter {
  return requests;
}

/** Answers that mean "busy, ask again", not "wrong request". */
export const BUSY_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

/**
 * Times a call is asked again after a busy answer. The waits grow 1, 2, 4, 8, 16 s, about half a
 * minute in all, which the run's own deadline still covers.
 */
export const BUSY_RETRIES = 5;
const MAX_BACKOFF_MS = 16_000;
/** How long an answer may take, and how long once the model thinks before it. */
const ANSWER_TIMEOUT_MS = 65_000;
const THINKING_TIMEOUT_MS = 180_000;
/** Tokens a thinking model gets for its reasoning on top of the answer's budget. */
const THINKING_TOKENS = 8192;

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
  return Math.max(retryAfterMs(retryAfter), jittered);
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
  private readonly requests: CompatibleRequests;
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
    this.requests = new CompatibleRequests(options.fetchImpl);
    this.limiter = options.limiter ?? requests;
  }

  async generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    // An already cancelled caller never asked the agent, so it is not a task.
    signal.throwIfAborted();
    const activityId = crypto.randomUUID();
    const startedAt = Date.now();
    const reportedName = agent.slice(0, 100);
    let outcome: AgentActivity['status'] = 'done';
    reportActivity(this.options.onActivity, {
      id: activityId,
      name: reportedName,
      status: 'running',
      startedAt,
    });
    try {
      const outputSchema = z.toJSONSchema(schema, { target: 'draft-7' });
      const generation = this.generation.get(agent);
      // The slide budgets are sized for answers, so a model thinks only when asked to, and then
      // gets more room and time for it.
      const thinking = this.options.thinking === true;
      const reasoningFields = reasoningRequestFields(
        this.options.reasoning,
        this.options.reasoningEffort,
        thinking,
      );
      const thinkingTokens = thinking ? THINKING_TOKENS : 0;
      const answerFormat = this.options.answerFormat;
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
      const budget = this.options.attemptBudget;
      // Every repeat — busy HTTP, bad JSON, a truncated answer, a timeout, a dropped connection —
      // spends one shared attempt. The first send does not. Without a budget the local caps stand.
      const allowRetry = (used: number, cap: number): boolean =>
        used < cap && (budget === undefined || budget.tryTake());
      for (;;) {
        signal.throwIfAborted();
        const reserve =
          Buffer.byteLength(system + JSON.stringify(input) + JSON.stringify(outputSchema), 'utf8') +
          (generation?.maxOutputTokens ?? 3600) * (attempt + 1) +
          thinkingTokens;
        const release = await this.limiter.acquire(
          signal,
          this.options.queueGroup ?? 'generation',
          reserve,
        );
        const started = Date.now();
        let wait = 500;
        try {
          signal.throwIfAborted();
          const response = await this.requests.post(
            this.endpoint,
            {
              headers: {
                ...this.options.headers,
                ...(this.options.apiKey.trim()
                  ? { Authorization: `Bearer ${this.options.apiKey}` }
                  : {}),
                'Content-Type': 'application/json',
              },
              // A redirect would carry the key to wherever the server points; refuse it instead.
              redirect: 'error',
              signal: AbortSignal.any([
                signal,
                AbortSignal.timeout(thinking ? THINKING_TIMEOUT_MS : ANSWER_TIMEOUT_MS),
              ]),
            },
            {
              model: this.model,
              seed: this.options.seed ?? 42,
              ...(samplingAllowed(this.options.reasoning, reasoningFields)
                ? { temperature: generation?.temperature ?? 0.35, top_p: generation?.topP ?? 1 }
                : {}),
              max_tokens: (generation?.maxOutputTokens ?? 3600) * (attempt + 1) + thinkingTokens,
              ...reasoningFields,
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
            },
            budget ? () => budget.tryTake() : undefined,
          );
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const failure = modelHttpFailure(
              response.status,
              this.model,
              response.headers.get('retry-after'),
              detail,
            );
            if (failure.failure.kind === 'quota-exhausted') throw failure;
            const allowed = BUSY_STATUSES.has(response.status) && allowRetry(busy, BUSY_RETRIES);
            if (!allowed) {
              const retrying = BUSY_STATUSES.has(response.status) && busy < BUSY_RETRIES;
              failure.message =
                `Model API HTTP ${response.status} for ${this.model}` +
                (busy ? ` after ${busy} retries` : '') +
                (retrying ? '; the shared attempt budget is exhausted' : '') +
                '; no alternate model was used.' +
                refusedParameter(detail);
              throw failure;
            }
            wait = retryDelay(busy++, response.headers.get('retry-after'));
            // 502 is a gateway hiccup; 429 and 503 say the provider is overloaded, so every
            // request in the process backs off, not only this one.
            if (response.status !== 502) this.limiter.throttle(wait);
          } else {
            const data = (await response.json()) as Completion;
            const choice = data.choices?.[0];
            const content =
              typeof choice?.message?.content === 'string' ? choice.message.content : '';
            const reasoning =
              typeof choice?.message?.reasoning_content === 'string'
                ? choice.message.reasoning_content
                : '';
            const refusal =
              typeof choice?.message?.refusal === 'string' ? choice.message.refusal : '';
            const maxTokens =
              (generation?.maxOutputTokens ?? 3600) * (attempt + 1) + thinkingTokens;
            if (!content.trim() || refusal.trim() || choice?.finish_reason === 'length') {
              if (allowRetry(attempt, 2)) {
                attempt += 1;
                continue;
              }
              const finish = ['stop', 'length', 'content_filter', 'tool_calls'].includes(
                choice?.finish_reason ?? '',
              )
                ? choice?.finish_reason
                : 'unknown';
              const count = (value: unknown): number =>
                typeof value === 'number' && Number.isFinite(value) ? value : 0;
              const usage = {
                prompt_tokens: count(data.usage?.prompt_tokens),
                completion_tokens: count(data.usage?.completion_tokens),
              };
              const metadata = {
                model: this.model.slice(0, 128),
                agent: agent.slice(0, 128),
                finish_reason: finish,
                contentChars: content.trim().length,
                reasoningChars: reasoning.trim().length,
                hasRefusal: refusal.trim().length > 0,
                attempts: attempt + 1,
                maxTokens,
                usage,
              };
              throw new Error(
                'Model returned empty or truncated JSON. ' + JSON.stringify(metadata),
              );
            }
            let result: T;
            try {
              result = parseModelJson(content, schema);
            } catch (error) {
              // Malformed or off-schema JSON: told what is wrong, a model usually fixes it; a second
              // miss is a sampling accident, and a fresh draw follows.
              if (!allowRetry(attempt, 2)) throw error;
              attempt += 1;
              repair =
                answerFormat && !repaired
                  ? { answer: content.slice(0, 20000), problems: problemsOf(error) }
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
          if (!(timedOut || dropped) || signal.aborted || !allowRetry(attempt, 2)) throw error;
          attempt += 1;
        } finally {
          release();
        }
        await backoff(wait, signal);
      }
    } catch (error) {
      outcome = cancelledCall(error, signal) ? 'cancelled' : 'failed';
      throw error;
    } finally {
      reportActivity(this.options.onActivity, {
        id: activityId,
        name: reportedName,
        status: outcome,
        startedAt,
        finishedAt: Date.now(),
      });
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
  get calls() {
    return [...new Set([this.fallback, ...this.providers.values()])].flatMap((provider) =>
      provider.calls.map((call) => ({ ...call, modelId: provider.model })),
    );
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
