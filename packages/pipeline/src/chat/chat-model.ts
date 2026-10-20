import { z } from 'zod';
import type { AgentGeneration, ReasoningCapability, ReasoningEffort } from '@lct/contracts';
import {
  acquireModelSlot,
  backoff,
  BUSY_STATUSES,
  parseModelJson,
  retryDelay,
  throttleModelSlots,
} from '../generation/provider.js';
import { modelHttpFailure } from './model-failure.js';
import { reasoningRequestFields, samplingAllowed } from '../models/reasoning.js';
import { CompatibleRequests } from '../models/compatibility.js';

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
  /** Missing only for legacy scripted providers. An incomplete step cannot authorize a tool. */
  readonly finishReason?:
    'stop' | 'tool_calls' | 'length' | 'content_filter' | 'protocol_error' | 'interrupted';
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelStepRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly signal: AbortSignal;
  /** Text as it arrives, reasoning blocks left out. */
  readonly onText?: (delta: string) => void;
  /** I replace provisional streamed text before a verified buffered retry. */
  readonly onTextReset?: () => void;
  /**
   * A tool call has begun: its name is known, its arguments are still being written. A plan is
   * long to write, and the person sees what the agent is doing meanwhile.
   */
  readonly onToolCall?: (name: string) => void;
  /**
   * Characters the model has just produced: text, reasoning and tool arguments alike. The person
   * watches the tokens grow by them before the server reports the step's usage.
   */
  readonly onGenerated?: (characters: number) => void;
}

/** The model a chat turn talks to. Tests replace it with recorded steps. */
export interface ChatModel {
  readonly model: string;
  /** Extra fallback instructions that also occupy the context window. */
  readonly contextOverheadChars?: number;
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
  /** Headers the server asks for besides the key, such as a gateway's `Project-ID`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Sent only when this model accepts `reasoning_effort`. */
  readonly reasoningEffort?: ReasoningEffort | null;
  /** Off only when the person switched thinking off for a model that can answer both ways. */
  readonly thinking?: boolean | null;
  /** What probing this model showed about thinking; without it no thinking field is sent. */
  readonly reasoning?: ReasoningCapability;
  readonly fetchImpl?: typeof fetch;
}

/** A slow step is a stuck step: the person waits in front of the chat. */
const STEP_TIMEOUT_MS = 180000;
/** Shared completion room for reasoning and a full deck outline/tool payload. */
const DEFAULT_CHAT_OUTPUT_TOKENS = 32768;

/**
 * The OpenAI chat completions API with tools, streamed. A server that refuses tools is asked in
 * the JSON mode instead: one answer is `{say, tool, arguments}`, the same tools described in the
 * system prompt, and the text arrives whole rather than streamed. A step offered no tools that
 * someone reads as it arrives (`onText`) streams: that mode would only hold it back. Without a
 * reader the JSON mode keeps the answer in shape.
 */
export class OpenAICompatibleChatModel implements ChatModel {
  readonly model: string;
  private readonly endpoint: string;
  private readonly requests: CompatibleRequests;
  private buffered = false;
  private withoutTools = false;

  get contextOverheadChars(): number {
    return this.options.jsonModeInstructions.length;
  }

  constructor(private readonly options: OpenAICompatibleChatOptions) {
    if (!options.baseUrl.trim()) throw new Error('The model server address is required.');
    if (!options.model.trim()) throw new Error('The model name is required.');
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.model = options.model;
    this.requests = new CompatibleRequests(options.fetchImpl);
  }

  async step(request: ModelStepRequest): Promise<ModelStep> {
    // One slot for the whole step: a streamed answer holds the connection until its last chunk.
    const bounded = {
      ...request,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]),
    };
    const release = await acquireModelSlot(bounded.signal);
    try {
      const streamed = request.tools.length > 0 ? !this.withoutTools : request.onText !== undefined;
      if (streamed) {
        const native = await this.native(bounded);
        if (native !== 'tools-refused') return native;
        this.withoutTools = true;
      }
      return await this.json(bounded);
    } finally {
      release();
    }
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const generation = this.options.generation;
    const reasoning = reasoningRequestFields(
      this.options.reasoning,
      this.options.reasoningEffort,
      this.options.thinking,
    );
    const sampling = samplingAllowed(this.options.reasoning, reasoning)
      ? { temperature: generation?.temperature ?? 0.4, top_p: generation?.topP ?? 1 }
      : {};
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.requests.post(
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
            signal: AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]),
          },
          {
            model: this.model,
            seed: this.options.seed ?? 42,
            ...sampling,
            max_tokens: generation?.maxOutputTokens ?? DEFAULT_CHAT_OUTPUT_TOKENS,
            ...reasoning,
            ...body,
          },
        );
      } catch (error) {
        // A dropped connection before any answer is a network accident: ask again. Stopping the
        // turn is not one.
        if (signal.aborted || attempt >= 2 || !(error instanceof TypeError)) throw error;
        await backoff(1000 * (attempt + 1), signal);
        continue;
      }
      if (response.ok || !BUSY_STATUSES.has(response.status) || attempt >= 2) {
        return response;
      }
      const classifiedBody = await response
        .clone()
        .text()
        .catch(() => '');
      const failure = modelHttpFailure(
        response.status,
        this.model,
        response.headers.get('retry-after'),
        classifiedBody,
      );
      if (failure.failure.kind === 'quota-exhausted') return response;
      const delay = Math.max(
        1500 * (attempt + 1),
        (failure.failure.retryAt ?? Date.now()) - Date.now(),
      );
      if (delay > 8000) return response;
      await response.body?.cancel();
      const wait = retryDelay(attempt, response.headers.get('retry-after'));
      if (response.status !== 502) throttleModelSlots(wait);
      await backoff(wait, signal);
    }
  }

  private async native(request: ModelStepRequest): Promise<ModelStep | 'tools-refused'> {
    const response = await this.post(
      {
        stream: !this.buffered,
        // Without it a streamed answer reports no usage at all.
        ...(this.buffered ? {} : { stream_options: { include_usage: true } }),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: 'auto',
            }
          : {}),
        messages: request.messages.map(openAiMessage),
      },
      request.signal,
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
      if (
        request.tools.length > 0 &&
        [400, 404, 422, 501].includes(response.status) &&
        /tool|function/i.test(detail)
      ) {
        return 'tools-refused';
      }
      throw failure;
    }
    const answer = await readCompletion(
      response,
      request.onText,
      request.onToolCall,
      request.onGenerated,
    );
    if (
      answer.bufferedRetry &&
      !this.buffered &&
      !request.signal.aborted &&
      (!answer.text || !request.onText || request.onTextReset)
    ) {
      if (answer.text) request.onTextReset?.();
      this.buffered = true;
      const verified = await this.native(request);
      return verified === 'tools-refused'
        ? verified
        : {
            ...verified,
            inputTokens: answer.inputTokens + verified.inputTokens,
            outputTokens: answer.outputTokens + verified.outputTokens,
          };
    }
    return answer;
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
      const detail = await response.text().catch(() => '');
      throw modelHttpFailure(
        response.status,
        this.model,
        response.headers.get('retry-after'),
        detail,
      );
    }
    const data = (await response.json()) as Completion;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    let answer: z.infer<typeof schema>;
    let finishReason = completionReason(choice?.finish_reason);
    try {
      answer = parseModelJson(content, schema);
    } catch {
      // A model that ignored the format still said something: show it, call nothing.
      answer = { say: stripThinking(content), tool: '', arguments: '' };
      finishReason = 'protocol_error';
    }
    if (answer.say) request.onText?.(answer.say);
    if (answer.tool && !names.includes(answer.tool)) finishReason = 'protocol_error';
    const tool = finishReason === 'stop' && names.includes(answer.tool) ? answer.tool : '';
    return {
      text: answer.say,
      toolCalls: tool
        ? [{ id: `call-${crypto.randomUUID()}`, name: tool, arguments: answer.arguments || '{}' }]
        : [],
      truncated: choice?.finish_reason === 'length',
      finishReason,
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
      /** Reasoning as vLLM, DeepSeek and OpenRouter stream it, apart from the answer. */
      reasoning_content?: string | null;
      reasoning?: string | null;
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

function completionReason(reason: unknown): NonNullable<ModelStep['finishReason']> {
  if (
    reason === 'stop' ||
    reason === 'tool_calls' ||
    reason === 'length' ||
    reason === 'content_filter'
  )
    return reason;
  return 'protocol_error';
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
  onGenerated?: (characters: number) => void,
): Promise<ModelStep & { bufferedRetry?: boolean }> {
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
  let protocolError = false;
  let interrupted = false;
  let bufferedRetry = false;
  let invalidChunk = false;
  let transportFailed = false;

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
    let ended = false;
    const take = (line: string) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        ended = true;
        return;
      }
      if (!payload) return;
      let chunk: Chunk;
      try {
        const value: unknown = JSON.parse(payload);
        if (
          !value ||
          typeof value !== 'object' ||
          !('choices' in value) ||
          !Array.isArray(value.choices)
        )
          throw new Error('Invalid completion chunk.');
        chunk = value as Chunk;
      } catch {
        protocolError = true;
        invalidChunk = true;
        return;
      }
      if (ended) {
        protocolError = true;
        invalidChunk = true;
        return;
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta;
      const generated =
        (delta?.content?.length ?? 0) +
        (delta?.reasoning_content?.length ?? 0) +
        (delta?.reasoning?.length ?? 0) +
        (delta?.tool_calls ?? []).reduce(
          (sum, part) =>
            sum + (part.function?.name?.length ?? 0) + (part.function?.arguments?.length ?? 0),
          0,
        );
      if (generated > 0) onGenerated?.(generated);
      if (choice.delta?.content) say(choice.delta.content);
      for (const part of choice.delta?.tool_calls ?? []) {
        const index = part.index;
        if (
          index === undefined ||
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index > calls.length
        ) {
          protocolError = true;
          if (index === undefined) bufferedRetry = true;
          else invalidChunk = true;
          continue;
        }
        const call = (calls[index] ??= { id: '', name: '', arguments: '' });
        if (part.id) call.id = part.id;
        const named = call.name !== '';
        if (part.function?.name) call.name += part.function.name;
        if (!named && call.name !== '') onToolCall?.(call.name);
        if (part.function?.arguments) call.arguments += part.function.arguments;
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          take(buffer.slice(0, newline).trim());
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      take(buffer.trim());
    } catch {
      interrupted = true;
      transportFailed = true;
    } finally {
      reader.releaseLock();
    }
    if (!ended) {
      if (!interrupted && (finish === 'stop' || finish === 'tool_calls')) bufferedRetry = true;
      interrupted = true;
    }
  }
  const rest = thinking.flush();
  if (rest) {
    text += rest;
    onText?.(rest);
  }
  if ((finish === 'stop' && calls.length > 0) || (finish === 'tool_calls' && calls.length === 0))
    protocolError = true;
  const finishReason = protocolError
    ? 'protocol_error'
    : interrupted
      ? 'interrupted'
      : completionReason(finish);
  const complete = finishReason === 'tool_calls' || finishReason === 'stop';
  return {
    text,
    ...(bufferedRetry &&
    !invalidChunk &&
    !transportFailed &&
    (finish === 'stop' || finish === 'tool_calls')
      ? { bufferedRetry: true }
      : {}),
    toolCalls: (complete ? calls : [])
      .filter((call) => call.name !== '')
      .map((call) => ({ ...call, id: call.id || `call-${crypto.randomUUID()}` })),
    truncated: finish === 'length',
    finishReason,
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
