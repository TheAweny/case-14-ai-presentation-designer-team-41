import { describe, expect, it, vi } from 'vitest';
import { anthropicTransport } from './anthropic-transport.js';
import { OpenAICompatibleChatModel } from '../chat/chat-model.js';
import { ledgerFetch, type AttemptLedger } from './attempt-ledger.js';

const endpoint = 'https://api.anthropic.com/v1/chat/completions';
const tools = [
  {
    type: 'function',
    function: {
      name: 'inspect',
      description: 'Inspect',
      parameters: { type: 'object', properties: { id: { type: 'string' } } },
    },
  },
];
const message = (content: unknown[], stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content,
  stop_reason,
  usage: { input_tokens: 11, output_tokens: 7 },
});
const init = (extra: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { Authorization: 'Bearer test-key', 'Project-ID': 'project' },
  body: JSON.stringify({
    model: 'claude-haiku-5-5',
    max_tokens: 8192,
    messages: [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Check' },
    ],
    ...extra,
  }),
});
const frame = (value: Record<string, unknown>) =>
  `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
const start = () => frame({ type: 'message_start', message: message([], '') });
const text = () => [
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
  frame({ type: 'content_block_stop', index: 0 }),
];
const end = (reason = 'end_turn') => [
  frame({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: 12 } }),
  frame({ type: 'message_stop' }),
];
const stream = (parts: string[]) =>
  new Response(parts.join(''), { headers: { 'content-type': 'text/event-stream' } });

describe('native Anthropic transport', () => {
  it('converts vision, headers and explicit thinking without OpenAI-only sampling parameters', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(message([{ type: 'text', text: '{"ok":true}' }])));
    const request = anthropicTransport(send, { thinking: true, reasoningEffort: 'low' });
    await request(
      endpoint,
      init({
        temperature: 0.2,
        top_p: 0.9,
        seed: 42,
        messages: [
          { role: 'system', content: 'System' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,YWJj' } },
              { type: 'image_url', image_url: { url: 'https://example.org/image.png' } },
            ],
          },
        ],
      }),
    );
    const [url, options] = send.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(options?.redirect).toBe('error');
    const headers = new Headers(options?.headers);
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: 'System' }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YWJj' } },
            { type: 'image', source: { type: 'url', url: 'https://example.org/image.png' } },
          ],
        },
      ],
    });
    for (const key of ['seed', 'temperature', 'top_p', 'response_format'])
      expect(body).not.toHaveProperty(key);
  });

  it('preserves thinking signatures only for the original account and exact tool/system prefix', async () => {
    const reply = message(
      [
        { type: 'thinking', thinking: '', signature: 'private-signature' },
        { type: 'text', text: 'Check ' },
        { type: 'text', text: 'now' },
        { type: 'tool_use', id: 'toolu_a', name: 'inspect', input: { id: '1' } },
      ],
      'tool_use',
    );
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(reply));
    const request = anthropicTransport(send, { thinking: true });
    const history = [
      {
        role: 'system',
        content: 'System\n\n<runtime-state>\n{"remainingMs":1000}\n</runtime-state>',
      },
      { role: 'user', content: 'Check' },
    ];
    await request(endpoint, init({ messages: history, tools }));
    const messages = [
      ...history,
      {
        role: 'assistant',
        content: 'Check now',
        tool_calls: [
          {
            type: 'function',
            id: 'toolu_a',
            function: { name: 'inspect', arguments: '{"id":"1"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_a', content: '{"ok":true}' },
    ];
    await request(
      endpoint,
      init({
        messages: [
          {
            role: 'system',
            content: 'System\n\n<runtime-state>\n{"remainingMs":500}\n</runtime-state>',
          },
          ...messages.slice(1),
        ],
        tools,
      }),
    );
    expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body)).messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: '',
      signature: 'private-signature',
    });
    await request(
      endpoint,
      init({ messages: [{ role: 'system', content: 'Changed' }, ...messages.slice(1)], tools }),
    );
    expect(String(send.mock.calls[2]?.[1]?.body)).not.toContain('private-signature');
    const changedKey = init({ messages, tools });
    changedKey.headers.Authorization = 'Bearer another-key';
    await request(endpoint, changedKey);
    expect(String(send.mock.calls[3]?.[1]?.body)).not.toContain('private-signature');
  });

  it.each(['max_tokens', 'refusal', 'unknown'])(
    'handles stop reason %s without authorizing incomplete tools',
    async (reason) => {
      const send: typeof fetch = async () =>
        Response.json(message([{ type: 'text', text: '{"ok":true}' }], reason));
      const requested = anthropicTransport(send)(endpoint, init());
      if (reason === 'unknown') await expect(requested).rejects.toThrow(/protocol/);
      else {
        const data = (await (await requested).json()) as {
          choices: [
            { finish_reason: string; message: { content: string; tool_calls?: unknown[] } },
          ];
        };
        expect(data.choices[0].finish_reason).toBe(
          reason === 'max_tokens' ? 'length' : 'content_filter',
        );
        expect(data.choices[0].message).not.toHaveProperty('tool_calls');
        if (reason === 'refusal') expect(data.choices[0].message.content).toBe('');
      }
    },
  );

  it('streams the first text before native EOF and commits usage before exposing final completion', async () => {
    let push: ReadableStreamDefaultController<Uint8Array> | undefined;
    const events: string[] = [];
    const ledger: AttemptLedger = {
      begin: async () => 'attempt',
      end: async () => {
        events.push('persisted');
      },
    };
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
      },
    });
    const send: typeof fetch = async () =>
      new Response(source, { headers: { 'content-type': 'text/event-stream' } });
    const response = await anthropicTransport(ledgerFetch(ledger, 'chat', send))(
      endpoint,
      init({ stream: true }),
    );
    const reader = response.body?.getReader();
    if (!reader || !push) throw new Error('Missing stream');
    const encoder = new TextEncoder();
    push.enqueue(encoder.encode(start() + text().join('')));
    let visible = '';
    while (!visible.includes('Hello'))
      visible += new TextDecoder().decode((await reader.read()).value);
    expect(events).toEqual([]);
    push.enqueue(encoder.encode(end().join('')));
    push.close();
    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += new TextDecoder().decode(next.value);
    }
    expect(events).toEqual(['persisted']);
    expect(rest).toContain('"finish_reason":"stop"');
    expect(rest).toContain('[DONE]');
  });

  it('decodes streamed tool arguments and keeps signatures on the next tool turn', async () => {
    const parts = [
      start(),
      frame({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_a', name: 'inspect', input: {} },
      }),
      frame({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"id":"1"}' },
      }),
      frame({ type: 'content_block_stop', index: 0 }),
      ...end('tool_use'),
    ];
    const send: typeof fetch = async () => stream(parts);
    const model = new OpenAICompatibleChatModel({
      apiKey: 'key',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-haiku-5-5',
      jsonModeInstructions: '',
      fetchImpl: anthropicTransport(send),
    });
    const step = await model.step({
      messages: [{ role: 'user', content: 'Check' }],
      tools: [{ name: 'inspect', description: 'Inspect', parameters: { type: 'object' } }],
      signal: AbortSignal.timeout(5000),
    });
    expect(step).toMatchObject({
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'toolu_a', name: 'inspect', arguments: '{"id":"1"}' }],
    });
  });

  it.each(['eof', 'error', 'malformed'])(
    'rejects %s streaming without a successful terminal event',
    async (reason) => {
      const parts = [start(), ...text()];
      if (reason === 'error')
        parts.push(frame({ type: 'error', error: { message: 'secret-provider-data' } }));
      if (reason === 'malformed') parts.push('data: {not json}\n\n');
      const response = await anthropicTransport(async () => stream(parts))(
        endpoint,
        init({ stream: true }),
      );
      await expect(response.text()).rejects.toThrow(/protocol|interrupted/);
    },
  );

  it('cancels a native stream when the caller aborts', async () => {
    const stop = new AbortController();
    const cancelled = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const request = anthropicTransport(
      async () => new Response(source, { headers: { 'content-type': 'text/event-stream' } }),
    );
    const response = await request(endpoint, { ...init({ stream: true }), signal: stop.signal });
    const pending = response.text();
    stop.abort(new DOMException('Stopped', 'AbortError'));
    await expect(pending).rejects.toThrow('Stopped');
    expect(cancelled).toHaveBeenCalled();
  });
});
