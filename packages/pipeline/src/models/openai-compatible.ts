import type { ModelEntry } from '@lct/contracts';
import type { AgentUsage, ModelProvider, ModelRequest } from './provider.js';
import { reasoningRequestFields, samplingAllowed } from './reasoning.js';

export interface OpenAICompatibleOptions {
  readonly model: ModelEntry;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Per-call time limit. A call that hangs must not eat the deck's five minutes. */
  readonly timeoutMs?: number;
  /**
   * How to hold the model to JSON: `schema` sends the answer's JSON Schema as structured output,
   * `object` asks for any JSON object, `off` sends no response_format for runtimes that reject
   * it. The answer is validated against the schema in every mode.
   */
  readonly jsonMode?: 'schema' | 'object' | 'off';
  readonly fetch?: typeof fetch;
  /** Requests to this runtime at once, shared by every provider that talks to it. */
  readonly maxConcurrent?: number;
  /** Headers the runtime asks for besides the key, such as a gateway's `Project-ID`. */
  readonly headers?: Readonly<Record<string, string>>;
}

interface ChatResponse {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; reasoning_content?: string | null };
  }[];
}

/**
 * Attempts per call. A hosted runtime answers now and then with nothing, or with 429 when its
 * quota of parallel requests is taken; the pause doubles between attempts.
 */
const ATTEMPTS = 4;
const FIRST_PAUSE_MS = 1_000;
const DEFAULT_MAX_CONCURRENT = 8;

/** A counting semaphore per runtime, so the whole run stays under the runtime's quota. */
class Gate {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const gates = new Map<string, Gate>();

function gateFor(baseUrl: string, limit: number): Gate {
  let gate = gates.get(baseUrl);
  if (gate === undefined) {
    gate = new Gate(limit);
    gates.set(baseUrl, gate);
  }
  return gate;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Any runtime that speaks the OpenAI chat completions API: vLLM, llama.cpp, SGLang, or a hosted
 * provider of open-weight models. The agent's instructions are the system message, its input the
 * user message as JSON, and generation parameters come from agent.yaml.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  readonly usage = new Map<string, AgentUsage>();
  private readonly options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    this.options = options;
    this.name = `openai-compatible:${options.model.id}`;
  }

  async complete(request: ModelRequest, feedback?: string): Promise<string> {
    const { model, baseUrl, apiKey } = this.options;
    const generation = request.agent.config.generation;
    const input = JSON.stringify(request.input);
    const userContent =
      request.images && request.images.length > 0
        ? [
            { type: 'text', text: input },
            ...request.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ]
        : input;
    const messages: { role: string; content: unknown }[] = [
      { role: 'system', content: request.agent.instructions },
      { role: 'user', content: userContent },
    ];
    if (feedback !== undefined) {
      messages.push({
        role: 'user',
        content: `The previous answer was not valid:\n${feedback}\nAnswer again with valid JSON only.`,
      });
    }
    const served = model.servedName ?? model.repo;
    const reasoning = reasoningRequestFields(served);
    const body: Record<string, unknown> = {
      ...reasoning,
      ...model.extraBody,
      model: served,
      messages,
      ...(samplingAllowed(served, reasoning)
        ? { temperature: generation.temperature, top_p: generation.topP }
        : {}),
      max_tokens: generation.maxOutputTokens,
      seed: request.seed,
    };
    const mode = this.options.jsonMode ?? 'schema';
    if (mode === 'schema' && request.responseSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { ...request.responseSchema, strict: true },
      };
    } else if (mode !== 'off') {
      body.response_format = { type: 'json_object' };
    }
    const doFetch = this.options.fetch ?? fetch;
    const gate = gateFor(baseUrl, this.options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    let reason = '';
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await pause(FIRST_PAUSE_MS * 2 ** (attempt - 1));
      }
      const response = await gate.run(() =>
        doFetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            ...this.options.headers,
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        }),
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (response.status === 429 || response.status >= 500) {
          reason = `HTTP ${response.status}: ${detail}`;
          continue;
        }
        throw new Error(`${this.name} answered HTTP ${response.status}: ${detail}`);
      }
      const payload = (await response.json()) as ChatResponse;
      const spent = this.usage.get(request.agent.config.id) ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      spent.calls += 1;
      spent.inputTokens += payload.usage?.prompt_tokens ?? 0;
      spent.outputTokens += payload.usage?.completion_tokens ?? 0;
      this.usage.set(request.agent.config.id, spent);
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content === 'string' && content.length > 0) {
        return content;
      }
      const thought = choice?.message?.reasoning_content ? ', only reasoning' : '';
      reason = `no message content (finish_reason ${choice?.finish_reason ?? 'none'}${thought})`;
    }
    throw new Error(`${this.name} returned ${reason}`);
  }
}
