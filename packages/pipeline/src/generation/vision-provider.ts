import type { ModelProvider, ModelRequest } from '../models/provider.js';
import type { AttemptBudget } from './attempt-budget.js';
import {
  backoff,
  BUSY_RETRIES,
  BUSY_STATUSES,
  retryDelay,
  sharedModelLimiter,
  type RequestLimiter,
} from './provider.js';

export interface VisionProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Headers the server asks for besides the key, such as a gateway's `Project-ID`. */
  headers?: Readonly<Record<string, string>>;
  seed?: number;
  /**
   * The shared prompts that carry the JSON Schema of an answer in the instructions and ask once
   * to repair an answer that misses it. A gateway that takes `response_format` and ignores it
   * still answers in shape.
   */
  answerFormat?: { readonly format: string; readonly repair: string };
  /** Cancels every request of the run. */
  signal?: AbortSignal;
  /** Slots shared with the text roles. The process-wide pool when omitted. */
  limiter?: RequestLimiter;
  queueGroup?: string;
  /**
   * Attempts shared by this build. The first request of a slide is free. Later transport
   * tries, and the schema-repair call, each take one.
   */
  attemptBudget?: AttemptBudget;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface Completion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Reads a slide with a vision model: the agent's instructions, its input as JSON and the picture
 * of the slide in one chat completion. It shares the process-wide request slots with the text
 * roles, so the reviewer never takes more of the model's quota than the run is given.
 */
export class VisionProvider implements ModelProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RequestLimiter;

  constructor(private readonly options: VisionProviderOptions) {
    if (!options.baseUrl.trim()) throw new Error('The model server address is required.');
    if (!options.model.trim()) throw new Error('The model name is required.');
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('The model server address must be an HTTP(S) base URL without credentials.');
    }
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.name = `${url.hostname}/${options.model}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.limiter = options.limiter ?? sharedModelLimiter();
  }

  async complete(request: ModelRequest, feedback?: string): Promise<string> {
    const { answerFormat } = this.options;
    const signal = AbortSignal.any([
      request.signal ?? new AbortController().signal,
      this.options.signal ?? new AbortController().signal,
    ]);
    const generation = request.agent.config.generation;
    const system = answerFormat
      ? `${request.agent.instructions}\n\n${answerFormat.format.replace(
          '{{schema}}',
          JSON.stringify(request.responseSchema?.schema ?? {}),
        )}`
      : request.agent.instructions;
    const user = [
      { type: 'text', text: JSON.stringify(request.input) },
      ...(request.images ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
    ];
    let busy = 0;
    let dropped = 0;
    let repairCharged = false;
    const budget = this.options.attemptBudget;
    const allowRetry = (used: number, cap: number): boolean =>
      used < cap && (budget === undefined || budget.tryTake());
    for (;;) {
      signal.throwIfAborted();
      if (feedback && !repairCharged) {
        repairCharged = true;
        if (budget !== undefined && !budget.tryTake()) {
          throw new Error(
            'Vision model repair for ' +
              this.options.model +
              ' was not sent; the shared attempt budget is exhausted.',
          );
        }
      }
      const release = await this.limiter.acquire(signal, this.options.queueGroup ?? 'vision');
      let wait = 500;
      try {
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
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          ]),
          body: JSON.stringify({
            model: this.options.model,
            seed: this.options.seed ?? request.seed,
            temperature: generation?.temperature ?? 0,
            top_p: generation?.topP ?? 1,
            max_tokens: generation?.maxOutputTokens ?? 2048,
            chat_template_kwargs: { enable_thinking: false },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
              ...(feedback && answerFormat
                ? [
                    { role: 'assistant', content: 'The previous answer did not fit the schema.' },
                    {
                      role: 'user',
                      content: answerFormat.repair.replace('{{problems}}', feedback),
                    },
                  ]
                : []),
            ],
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const busyStatus = BUSY_STATUSES.has(response.status);
          if (!busyStatus || !allowRetry(busy, BUSY_RETRIES)) {
            throw new Error(
              'Vision model HTTP ' +
                String(response.status) +
                ' for ' +
                this.options.model +
                '.' +
                (busyStatus && busy < BUSY_RETRIES
                  ? ' The shared attempt budget is exhausted.'
                  : ''),
            );
          }
          wait = retryDelay(busy++, response.headers.get('retry-after'));
          if (response.status !== 502) this.limiter.throttle(wait);
        } else {
          const data = (await response.json()) as Completion;
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            this.limiter.succeeded();
            return content;
          }
          throw new Error('The vision model returned an empty answer.');
        }
      } catch (error) {
        // A slow answer or a dropped connection costs one more try, a cancelled run stops at once.
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        if (
          !(timedOut || error instanceof TypeError) ||
          signal.aborted ||
          !allowRetry(dropped, 2)
        ) {
          throw error;
        }
        dropped += 1;
      } finally {
        release();
      }
      await backoff(wait, signal);
    }
  }
}
