import { createHash } from 'node:crypto';
import { stableRuntimeInstructions } from '../runtime-state.js';

export interface AnthropicTransportOptions {
  readonly thinking?: boolean | null;
  readonly reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | null;
}

type Json = Record<string, unknown>;
type Message = { role: string; content: Json[] };
type Remember = (content: Json[]) => void;

function protocol(): never {
  // Never include provider payloads: they can contain credentials or private reasoning.
  throw new Error('Anthropic transport protocol error or interrupted response.');
}
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return protocol();
  return value as Json;
}
function string(value: unknown): string {
  if (typeof value !== 'string') return protocol();
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return protocol();
  return value;
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function content(value: unknown): Json[] {
  if (value == null || value === '') return [];
  if (typeof value === 'string') return [{ type: 'text', text: value }];
  return array(value).map((entry) => {
    const part = object(entry);
    if (part.type === 'text') return { type: 'text', text: string(part.text) };
    if (part.type !== 'image_url') return protocol();
    const url = string(object(part.image_url).url);
    const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (data)
      return { type: 'image', source: { type: 'base64', media_type: data[1], data: data[2] } };
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return protocol();
    return { type: 'image', source: { type: 'url', url } };
  });
}
function toolCalls(value: unknown): Json[] {
  return array(value).map((entry) => {
    const call = object(entry);
    if (call.type !== 'function') return protocol();
    const fn = object(call.function);
    return {
      type: 'tool_use',
      id: string(call.id),
      name: string(fn.name),
      input: object(JSON.parse(string(fn.arguments))),
    };
  });
}
function finish(reason: unknown, blocks: Json[]): string {
  const tools = blocks.filter((block) => block.type === 'tool_use');
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'length';
  if (reason === 'refusal') return 'content_filter';
  if (reason === 'tool_use' && tools.length > 0) return 'tool_calls';
  if ((reason === 'end_turn' || reason === 'stop_sequence') && tools.length === 0) return 'stop';
  return protocol();
}
function validateBlock(block: Json): void {
  switch (block.type) {
    case 'text':
      string(block.text);
      return;
    case 'tool_use':
      string(block.id);
      string(block.name);
      object(block.input);
      return;
    case 'thinking':
      string(block.thinking);
      string(block.signature);
      return;
    case 'redacted_thinking':
      string(block.data);
      return;
    default:
      protocol();
  }
}
function usage(value: Json): Json {
  const tokens = (key: string): number => {
    const count = value[key] ?? 0;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return protocol();
    return count;
  };
  const cached = tokens('cache_read_input_tokens');
  const input = tokens('input_tokens') + cached + tokens('cache_creation_input_tokens');
  const output = tokens('output_tokens');
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
    prompt_tokens_details: { cached_tokens: cached },
  };
}
function completion(message: Json, remember: Remember): Json {
  if (message.type !== 'message' || message.role !== 'assistant') return protocol();
  const blocks = array(message.content).map(object);
  blocks.forEach(validateBlock);
  const reason = finish(message.stop_reason, blocks);
  const calls = blocks
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: JSON.stringify(block.input) },
    }));
  if (reason === 'stop' || reason === 'tool_calls') remember(blocks);
  return {
    id: string(message.id),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: string(message.model),
    choices: [
      {
        index: 0,
        finish_reason: reason,
        message: {
          role: 'assistant',
          content:
            reason === 'content_filter'
              ? ''
              : blocks
                  .filter((block) => block.type === 'text')
                  .map((block) => block.text)
                  .join(''),
          ...(reason === 'content_filter' ? { refusal: 'Anthropic refused this request.' } : {}),
          ...(reason === 'tool_calls' ? { tool_calls: calls } : {}),
        },
      },
    ],
    usage: usage(object(message.usage)),
  };
}

/** Native Messages API behind the existing OpenAI HTTP callers. No retries or prompts here. */
export function anthropicTransport(
  transport: typeof fetch,
  options: AnthropicTransportOptions = {},
): typeof fetch {
  // Bounded, adapter-local, account- and exact-prefix-bound. Nothing is persisted or exposed.
  const transcripts = new Map<string, Json[]>();
  return async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    if (
      !/\/chat\/completions\/?$/.test(url.pathname) ||
      request.method !== 'POST' ||
      url.username ||
      url.password
    )
      return protocol();
    url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, '/messages');
    const body = object(await request.json());
    const headers = new Headers(request.headers);
    const bearer = /^Bearer\s+(.+)$/i.exec(headers.get('authorization') ?? '');
    const key = bearer?.[1] ?? headers.get('x-api-key');
    if (!key) return protocol();
    // Keep routing/project headers, but discard credentials for other protocols and framing.
    const connection = headers.get('connection') ?? '';
    for (const name of connection
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean))
      headers.delete(name);
    for (const name of [
      'authorization',
      'proxy-authorization',
      'cookie',
      'host',
      'content-length',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'upgrade',
      'te',
      'trailer',
      'accept-encoding',
      'anthropic-beta',
    ])
      headers.delete(name);
    headers.set('x-api-key', key);
    headers.set('anthropic-version', '2023-06-01');
    headers.set('content-type', 'application/json');
    headers.set('accept', body.stream === true ? 'text/event-stream' : 'application/json');
    const system: Json[] = [];
    const messages: Message[] = [];
    const original = array(body.messages).map(object);
    // Remaining runtime quotas change every step. Signed reasoning belongs to the unchanged
    // conversation and policy, while these trusted scalar facts are deliberately refreshed.
    const stableMessage = (message: Json): Json =>
      (message.role === 'system' || message.role === 'developer') &&
      typeof message.content === 'string'
        ? { ...message, content: stableRuntimeInstructions(message.content) }
        : message;
    const context = {
      endpoint: url.href,
      account: digest(key),
      model: body.model,
      system: original
        .filter((m) => m.role === 'system' || m.role === 'developer')
        .map(stableMessage),
      tools: body.tools ?? null,
      toolChoice: body.tool_choice ?? null,
    };
    const prefixKey = (prefix: Json[], visible: Json[]) =>
      digest([context, prefix.map(stableMessage), visible]);
    for (let i = 0; i < original.length; i++) {
      const message = original[i];
      if (!message) return protocol();
      if (message.role === 'system' || message.role === 'developer') {
        const parts = content(message.content);
        if (parts.some((part) => part.type !== 'text')) return protocol();
        system.push(...parts);
        continue;
      }
      let parts: Json[];
      let role: string;
      if (message.role === 'tool') {
        role = 'user';
        parts = [
          {
            type: 'tool_result',
            tool_use_id: string(message.tool_call_id),
            content: content(message.content),
          },
        ];
      } else {
        if (message.role !== 'user' && message.role !== 'assistant') return protocol();
        role = message.role;
        parts = content(message.content);
        if (message.tool_calls !== undefined) {
          if (role !== 'assistant') return protocol();
          parts.push(...toolCalls(message.tool_calls));
        }
        if (role === 'assistant')
          parts = structuredClone(transcripts.get(prefixKey(original.slice(0, i), parts)) ?? parts);
      }
      const previous = messages.at(-1);
      if (previous?.role === role) previous.content.push(...parts);
      else messages.push({ role, content: parts });
    }
    const remember: Remember = (blocks) => {
      const visible = [
        ...content(
          blocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(''),
        ),
        ...blocks.filter((block) => block.type === 'tool_use'),
      ];
      const cacheKey = prefixKey(original, visible);
      transcripts.delete(cacheKey);
      transcripts.set(cacheKey, structuredClone(blocks));
      while (transcripts.size > 128) {
        const oldest = transcripts.keys().next().value;
        if (oldest === undefined) break;
        transcripts.delete(oldest);
      }
    };
    const effort = options.reasoningEffort ?? body.reasoning_effort;
    const template =
      body.chat_template_kwargs == null
        ? undefined
        : object(body.chat_template_kwargs).enable_thinking;
    const thinking =
      options.thinking ??
      (options.reasoningEffort != null
        ? effort !== 'none'
        : (template ?? (effort != null && effort !== 'none')));
    if (
      typeof thinking !== 'boolean' ||
      (effort != null && !['none', 'low', 'medium', 'high'].includes(string(effort)))
    )
      return protocol();
    const native: Json = {
      model: string(body.model),
      max_tokens: body.max_completion_tokens ?? body.max_tokens ?? 32768,
      messages,
      ...(system.length ? { system } : {}),
      stream: body.stream === true,
      thinking: { type: thinking ? 'adaptive' : 'disabled' },
      ...(thinking
        ? { output_config: { effort: effort && effort !== 'none' ? effort : 'medium' } }
        : {}),
    };
    if (body.stop != null)
      native.stop_sequences =
        typeof body.stop === 'string' ? [body.stop] : array(body.stop).map(string);
    if (body.tools != null && array(body.tools).length) {
      native.tools = array(body.tools).map((entry) => {
        const tool = object(entry);
        if (tool.type !== 'function') return protocol();
        const fn = object(tool.function);
        return {
          name: string(fn.name),
          ...(fn.description != null ? { description: string(fn.description) } : {}),
          input_schema: object(fn.parameters),
        };
      });
      if (body.tool_choice != null && body.tool_choice !== 'auto') return protocol();
      native.tool_choice = { type: 'auto' };
    }
    request.signal.throwIfAborted();
    const response = await transport(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(native),
      signal: request.signal,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    request.signal.throwIfAborted();
    const safeHeaders = new Headers();
    for (const name of ['retry-after', 'request-id', 'x-request-id']) {
      const value = response.headers.get(name);
      if (value) safeHeaders.set(name, value);
    }
    if (!response.ok) {
      await response.body?.cancel();
      safeHeaders.set('content-type', 'application/json');
      return new Response(
        JSON.stringify({
          error: { type: 'anthropic_http_error', message: `Anthropic HTTP ${response.status}` },
        }),
        { status: response.status === 529 ? 503 : response.status, headers: safeHeaders },
      );
    }
    if (
      body.stream === true &&
      response.headers.get('content-type')?.includes('text/event-stream')
    ) {
      if (!response.body) return protocol();
      safeHeaders.set('content-type', 'text/event-stream');
      return new Response(streamResponse(response.body, request.signal, remember), {
        status: response.status,
        headers: safeHeaders,
      });
    }
    const result = completion(object(await response.json()), remember);
    request.signal.throwIfAborted();
    safeHeaders.set('content-type', 'application/json');
    return new Response(JSON.stringify(result), { status: response.status, headers: safeHeaders });
  };
}

function streamResponse(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  remember: Remember,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let message: Json | undefined;
  let stopped = false;
  let terminal = false;
  let active: number | undefined;
  let reason: unknown;
  let totals: Json = {};
  const blocks: Json[] = [];
  const toolIndexes = new Map<number, number>();
  const partials = new Map<number, string>();
  let detach: () => void = () => undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const abort = () => {
        controller.error(signal.reason);
        void reader.cancel(signal.reason).catch(() => undefined);
        detach();
      };
      detach = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller) {
      const emit = (delta: Json, finishReason: string | null = null, final = false) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              id: message?.id,
              object: 'chat.completion.chunk',
              created: 0,
              model: message?.model,
              choices: [{ index: 0, delta, finish_reason: finishReason }],
              ...(final ? { usage: usage(totals) } : {}),
            })}\n\n`,
          ),
        );
      };
      const event = (frame: string) => {
        const lines = frame.split('\n');
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) {
          if (lines.every((line) => !line || line.startsWith(':'))) return;
          return protocol();
        }
        const value = object(JSON.parse(data));
        const name = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        if (name && name !== value.type) return protocol();
        if (stopped || value.type === 'error') return protocol();
        if (value.type === 'ping') return;
        if (value.type === 'message_start') {
          if (message) return protocol();
          message = object(value.message);
          if (
            message.type !== 'message' ||
            message.role !== 'assistant' ||
            array(message.content).length
          )
            return protocol();
          string(message.id);
          string(message.model);
          totals = object(message.usage);
          usage(totals);
          emit({ role: 'assistant' });
          return;
        }
        if (!message) return protocol();
        if (value.type === 'message_delta') {
          if (active !== undefined || terminal) return protocol();
          reason = object(value.delta).stop_reason;
          if (reason == null) return protocol();
          terminal = true;
          totals = { ...totals, ...(value.usage == null ? {} : object(value.usage)) };
          usage(totals);
          return;
        }
        if (value.type === 'message_stop') {
          if (!terminal || active !== undefined) return protocol();
          finish(reason, blocks);
          stopped = true;
          return;
        }
        if (terminal) return protocol();
        const index = value.index;
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0)
          return protocol();
        if (value.type === 'content_block_start') {
          if (active !== undefined || index !== blocks.length) return protocol();
          const block = structuredClone(object(value.content_block));
          validateBlock(block);
          blocks.push(block);
          active = index;
          if (block.type === 'text' && block.text) emit({ content: block.text });
          if (block.type === 'tool_use') {
            if (
              blocks
                .slice(0, -1)
                .some((other) => other.type === 'tool_use' && other.id === block.id)
            )
              return protocol();
            const toolIndex = toolIndexes.size;
            toolIndexes.set(index, toolIndex);
            emit({
              tool_calls: [
                {
                  index: toolIndex,
                  id: block.id,
                  type: 'function',
                  function: { name: block.name, arguments: '' },
                },
              ],
            });
          }
          return;
        }
        if (active !== index) return protocol();
        const block = blocks[index];
        if (!block) return protocol();
        if (value.type === 'content_block_delta') {
          const delta = object(value.delta);
          if (block.type === 'text' && delta.type === 'text_delta') {
            const text = string(delta.text);
            block.text = string(block.text) + text;
            emit({ content: text });
          } else if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
            const json = string(delta.partial_json);
            partials.set(index, (partials.get(index) ?? '') + json);
            emit({
              tool_calls: [{ index: toolIndexes.get(index), function: { arguments: json } }],
            });
          } else if (block.type === 'thinking' && delta.type === 'thinking_delta')
            block.thinking = string(block.thinking) + string(delta.thinking);
          else if (block.type === 'thinking' && delta.type === 'signature_delta')
            block.signature = string(block.signature) + string(delta.signature);
          else return protocol();
          return;
        }
        if (value.type !== 'content_block_stop') return protocol();
        if (block.type === 'tool_use') {
          const json = partials.get(index);
          // Partial tool input is allowed only for a length finish, never executable.
          if (json) {
            try {
              block.input = object(JSON.parse(json));
            } catch {
              block.input = null;
            }
          } else
            emit({
              tool_calls: [
                {
                  index: toolIndexes.get(index),
                  function: { arguments: JSON.stringify(block.input) },
                },
              ],
            });
        }
        active = undefined;
      };
      try {
        for (;;) {
          signal.throwIfAborted();
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary) {
            const frame = buffer.slice(0, boundary.index).replace(/\r\n/g, '\n');
            buffer = buffer.slice(boundary.index + boundary[0].length);
            event(frame);
            // Let text/tool deltas reach the consumer before reading another native chunk.
            if ((controller.desiredSize ?? 0) <= 0) return;
            continue;
          }
          const next = await reader.read();
          signal.throwIfAborted();
          if (!next.done) {
            buffer += decoder.decode(next.value, { stream: true });
            continue;
          }
          buffer += decoder.decode();
          if (buffer.trim() || !stopped) return protocol();
          const finalReason = finish(reason, blocks);
          if (finalReason === 'stop' || finalReason === 'tool_calls') {
            blocks.forEach(validateBlock);
            remember(blocks);
          }
          // Native EOF must be observed first: the inner ledger commits before this finish.
          emit({}, finalReason, true);
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          detach();
          reader.releaseLock();
          return;
        }
      } catch (error) {
        detach();
        controller.error(
          signal.aborted
            ? signal.reason
            : new Error('Anthropic stream protocol error or interrupted response.'),
        );
        await reader.cancel(error).catch(() => undefined);
      }
    },
    async cancel(reason) {
      detach();
      await reader.cancel(reason);
    },
  });
}
