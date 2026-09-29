import { z } from 'zod';
import type { AgentGeneration } from '@lct/contracts';
import { acquireModelSlot, backoff, parseModelJson } from '../generation/provider.js';

/** A tool as the model sees it: a name, what it is for, and its input as JSON Schema. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** The arguments as the model wrote them: JSON text, not yet checked. */
  readonly arguments: string;
}

export type ModelMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string;
      readonly toolCalls?: readonly ToolCall[];
    }
  | { readonly role: 'tool'; readonly callId: string; readonly content: string };

/** One answer of the model: what it said and the tools it asked for. */
export interface ModelStep {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  /** The answer hit the token limit. */
  readonly truncated: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelStepRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly signal: AbortSignal;
  /** Text as it arrives, reasoning blocks left out. */
  readonly onText?: (delta: string) => void;
  /**
   * A tool call has begun: its name is known, its arguments are still being written. A plan is
   * long to write, and the person sees what the agent is doing meanwhile.
   */
  readonly onToolCall?: (name: string) => void;
}

/** The model a chat turn talks to. Tests replace it with recorded steps. */
export interface ChatModel {
  readonly model: string;
  step(request: ModelStepRequest): Promise<ModelStep>;
}

export interface OpenAICompatibleChatOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly generation?: AgentGeneration;
  readonly seed?: number;
  /**
   * How to ask a model without function calling for a tool: prepended to the system prompt in the
   * JSON mode. It is a prompt, so it comes from the registry.
   */
  readonly jsonModeInstructions: string;
  readonly fetchImpl?: typeof fetch;
}

/** A slow step is a stuck step: the person waits in front of the chat. */
const STEP_TIMEOUT_MS = 180000;

/**
 * Servers known to refuse `tools` in this process, by endpoint and model. A server started without
 * a tool parser (vLLM without `--enable-auto-tool-choice`, older Ollama) answers 400 to every
 * request with tools; after the first refusal the chat asks it in the JSON mode straight away.
 */
const withoutTools = new Set<string>();

/**
 * The OpenAI chat completions API with tools, streamed. A server that refuses tools is asked in
 * the JSON mode instead: one answer is `{say, tool, arguments}`, the same tools described in the
 * system prompt, and the text arrives whole rather than streamed.
 */
export class OpenAICompatibleChatModel implements ChatModel {
  readonly model: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAICompatibleChatOptions) {
    if (!options.baseUrl.trim()) throw new Error('The model server address is required.');
    if (!options.model.trim()) throw new Error('The model name is required.');
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private get key(): string {
    return `${this.endpoint} ${this.model}`;
  }

  async step(request: ModelStepRequest): Promise<ModelStep> {
    // One slot for the whole step: a streamed answer holds the connection until its last chunk.
    const release = await acquireModelSlot(request.signal);
    try {
      if (request.tools.length > 0 && !withoutTools.has(this.key)) {
        const native = await this.native(request);
        if (native !== 'tools-refused') return native;
        withoutTools.add(this.key);
      }
      return await this.json(request);
    } finally {
      release();
    }
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const generation = this.options.generation;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            ...(this.options.apiKey.trim()
              ? { Authorization: `Bearer ${this.options.apiKey}` }
              : {}),
            'Content-Type': 'application/json',
          },
          // A redirect would carry the key to wherever the server points; refuse it instead.
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]),
          body: JSON.stringify({
            model: this.model,
            seed: this.options.seed ?? 42,
            temperature: generation?.temperature ?? 0.4,
            top_p: generation?.topP ?? 1,
            max_tokens: generation?.maxOutputTokens ?? 4096,
            chat_template_kwargs: { enable_thinking: false },
            ...body,
          }),
        });
      } catch (error) {
        // A dropped connection before any answer is a network accident: ask again. Stopping the
        // turn is not one.
        if (signal.aborted || attempt >= 2 || !(error instanceof TypeError)) throw error;
        await backoff(1000 * (attempt + 1), signal);
        continue;
      }
      if (response.ok || ![429, 502, 503].includes(response.status) || attempt >= 2) {
        return response;
      }
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('retry-after'));
      await backoff(Math.min(8000, Math.max(1500 * (attempt + 1), retryAfter * 1000 || 0)), signal);
    }
  }

  private async native(request: ModelStepRequest): Promise<ModelStep | 'tools-refused'> {
    const response = await this.post(
      {
        stream: true,
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
        tool_choice: 'auto',
        messages: request.messages.map(openAiMessage),
      },
      request.signal,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if ([400, 404, 422, 501].includes(response.status) && /tool|function/i.test(detail)) {
        return 'tools-refused';
      }
      throw new Error(`Model API HTTP ${response.status} for ${this.model}.`);
    }
    return readCompletion(response, request.onText, request.onToolCall);
  }

  private async json(request: ModelStepRequest): Promise<ModelStep> {
    const names = request.tools.map((tool) => tool.name);
    const schema = z.object({
      say: z.string(),
      tool: z.string(),
      arguments: z.string(),
    });
    const [system, ...rest] = request.messages;
    const prompt = [
      system?.role === 'system' ? system.content : '',
      this.options.jsonModeInstructions,
      JSON.stringify(request.tools),
    ].join('\n\n');
    const response = await this.post(
      {
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'chat_step',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                say: { type: 'string' },
                tool: { type: 'string', enum: ['', ...names] },
                arguments: { type: 'string' },
              },
              required: ['say', 'tool', 'arguments'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          { role: 'system', content: prompt },
          ...(system?.role === 'system' ? rest : request.messages).map(jsonModeMessage),
        ],
      },
      request.signal,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Model API HTTP ${response.status} for ${this.model}.`);
    }
    const data = (await response.json()) as Completion;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    let answer: z.infer<typeof schema>;
    try {
      answer = parseModelJson(content, schema);
    } catch {
      // A model that ignored the format still said something: show it, call nothing.
      answer = { say: stripThinking(content), tool: '', arguments: '' };
    }
    if (answer.say) request.onText?.(answer.say);
    const tool = names.includes(answer.tool) ? answer.tool : '';
    return {
      text: answer.say,
      toolCalls: tool
        ? [{ id: `call-${crypto.randomUUID()}`, name: tool, arguments: answer.arguments || '{}' }]
        : [],
      truncated: choice?.finish_reason === 'length',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

interface Completion {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface Chunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function openAiMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: message.callId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}

/** Without a tool role a call is the assistant's JSON answer, and its result a user message. */
function jsonModeMessage(message: ModelMessage): Record<string, unknown> {
  switch (message.role) {
    case 'assistant': {
      const call = message.toolCalls?.[0];
      return {
        role: 'assistant',
        content: JSON.stringify({
          say: message.content,
          tool: call?.name ?? '',
          arguments: call?.arguments ?? '',
        }),
      };
    }
    case 'tool':
      return { role: 'user', content: JSON.stringify({ toolResult: message.content }) };
    default:
      return { role: message.role, content: message.content };
  }
}

/** Read an answer: a stream of chunks, or the whole completion from a server that ignored `stream`. */
async function readCompletion(
  response: Response,
  onText?: (delta: string) => void,
  onToolCall?: (name: string) => void,
): Promise<ModelStep> {
  const thinking = new ThinkingFilter();
  let text = '';
  const say = (delta: string) => {
    const visible = thinking.push(delta);
    if (!visible) return;
    text += visible;
    onText?.(visible);
  };
  const calls: { id: string; name: string; arguments: string }[] = [];
  let finish: string | null | undefined;
  let usage: Chunk['usage'];

  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = (await response.json()) as Completion;
    const choice = data.choices?.[0];
    say(choice?.message?.content ?? '');
    for (const call of choice?.message?.tool_calls ?? []) {
      calls.push({
        id: call.id ?? `call-${crypto.randomUUID()}`,
        name: call.function?.name ?? '',
        arguments: call.function?.arguments ?? '',
      });
    }
    finish = choice?.finish_reason;
    usage = data.usage;
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The model answer has no body.');
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(payload) as Chunk;
        } catch {
          continue;
        }
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        if (choice.delta?.content) say(choice.delta.content);
        for (const part of choice.delta?.tool_calls ?? []) {
          const index = part.index ?? calls.length;
          const call = (calls[index] ??= { id: '', name: '', arguments: '' });
          if (part.id) call.id = part.id;
          const named = call.name !== '';
          if (part.function?.name) call.name += part.function.name;
          if (!named && call.name !== '') onToolCall?.(call.name);
          if (part.function?.arguments) call.arguments += part.function.arguments;
        }
      }
    }
  }
  const rest = thinking.flush();
  if (rest) {
    text += rest;
    onText?.(rest);
  }
  return {
    text,
    toolCalls: calls
      .filter((call) => call.name !== '')
      .map((call) => ({ ...call, id: call.id || `call-${crypto.randomUUID()}` })),
    truncated: finish === 'length',
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  };
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
}

const OPEN = '<think>';
const CLOSE = '</think>';

/**
 * Leaves reasoning blocks out of streamed text. A tag can be split between chunks, so the end of a
 * chunk that could start one is held back until the next chunk decides.
 */
export class ThinkingFilter {
  private buffer = '';
  private inside = false;
  private started = false;

  push(delta: string): string {
    this.buffer += delta;
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = this.buffer.indexOf(CLOSE);
        if (end < 0) {
          this.buffer = this.buffer.slice(-(CLOSE.length - 1));
          return this.visible(out);
        }
        this.buffer = this.buffer.slice(end + CLOSE.length);
        this.inside = false;
        continue;
      }
      const start = this.buffer.indexOf(OPEN);
      if (start >= 0) {
        out += this.buffer.slice(0, start);
        this.buffer = this.buffer.slice(start + OPEN.length);
        this.inside = true;
        continue;
      }
      const hold = partialTagLength(this.buffer, OPEN);
      out += this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      return this.visible(out);
    }
  }

  flush(): string {
    const rest = this.inside ? '' : this.buffer;
    this.buffer = '';
    return this.visible(rest);
  }

  /** The answer after a reasoning block starts with the blank lines that followed the block. */
  private visible(text: string): string {
    if (this.started) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed) this.started = true;
    return trimmed;
  }
}

function partialTagLength(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (tag.startsWith(text.slice(-length))) return length;
  }
  return 0;
}
