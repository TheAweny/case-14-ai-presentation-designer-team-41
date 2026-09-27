import type { ModelEntry } from '@lct/contracts';
import type { ModelProvider, ModelRequest } from './provider.js';

export interface OpenAICompatibleOptions {
  readonly model: ModelEntry;
  readonly baseUrl: string;
  readonly apiKey: string;
  /** Per-call time limit. A call that hangs must not eat the deck's five minutes. */
  readonly timeoutMs?: number;
  /** Ask the runtime for a JSON object. Off for runtimes that reject response_format. */
  readonly jsonMode?: boolean;
  readonly fetch?: typeof fetch;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Any runtime that speaks the OpenAI chat completions API: vLLM, llama.cpp, SGLang, or a hosted
 * provider of open-weight models. The agent's instructions are the system message, its input the
 * user message as JSON, and generation parameters come from agent.yaml.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
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
    const body: Record<string, unknown> = {
      model: model.servedName ?? model.repo,
      messages,
      temperature: generation.temperature,
      top_p: generation.topP,
      max_tokens: generation.maxOutputTokens,
      seed: request.seed,
    };
    if (this.options.jsonMode ?? true) {
      body.response_format = { type: 'json_object' };
    }
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`${this.name} answered HTTP ${response.status}: ${detail}`);
    }
    const payload = (await response.json()) as ChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(`${this.name} returned no message content.`);
    }
    return content;
  }
}
