import { describe, expect, it, vi } from 'vitest';
import { ModelRequestError } from './model-failure.js';
import { OpenAICompatibleChatModel, ThinkingFilter, type ToolSpec } from './chat-model.js';

const tools: ToolSpec[] = [
  { name: 'list_templates', description: 'List templates.', parameters: { type: 'object' } },
];

function stream(chunks: unknown[]): Response {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function model(fetchImpl: typeof fetch, name = `model-${crypto.randomUUID()}`) {
  return new OpenAICompatibleChatModel({
    apiKey: 'key',
    baseUrl: 'https://models.example/v1',
    model: name,
    jsonModeInstructions: 'Answer as JSON.',
    fetchImpl,
  });
}

describe('ThinkingFilter', () => {
  it('drops a reasoning block split between chunks', () => {
    const filter = new ThinkingFilter();
    const out = ['<thi', 'nk>plan it</th', 'ink>\n\nПри', 'вет <', 'b>'].map((chunk) =>
      filter.push(chunk),
    );
    expect(out.join('') + filter.flush()).toBe('Привет <b>');
  });
});

describe('OpenAICompatibleChatModel', () => {
  it.each([true, false])(
    'keeps thinking enabled in native and JSON requests (tools=%s)',
    async (native) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: native
                  ? '<think>Internal notes</think>Ответ'
                  : '<think>Internal notes</think>{"say":"Ответ","tool":"","arguments":""}',
              },
              finish_reason: 'stop',
            },
          ],
        }),
      );
      const onText = vi.fn();
      const step = await model(fetchImpl, 'Qwen/Qwen3.5-27B').step({
        messages: [],
        tools: native ? tools : [],
        signal: AbortSignal.timeout(5000),
        onText,
      });
      expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).chat_template_kwargs).toEqual({
        enable_thinking: true,
      });
      expect(step.text).toBe('Ответ');
      expect(onText.mock.calls.flat().join('')).toBe('Ответ');
    },
  );

  it('rejects tool calls paired with a stop finish reason instead of tool_calls', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      stream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: 'list_templates', arguments: '{}' } },
                ],
              },
              finish_reason: 'stop',
            },
          ],
        },
      ]),
    );
    const step = await model(fetchImpl).step({
      messages: [],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step.toolCalls).toEqual([]);
    expect(step.finishReason).toBe('protocol_error');
  });

  it('keeps visible partial text but discards tools when the provider transport fails', async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0)
          controller.enqueue(
            encoder.encode(
              'data: ' +
                JSON.stringify({
                  choices: [
                    {
                      delta: {
                        content: 'Часть ответа',
                        tool_calls: [
                          {
                            index: 0,
                            id: 'c1',
                            function: { name: 'list_templates', arguments: '{}' },
                          },
                        ],
                      },
                    },
                  ],
                }) +
                '\n\n',
            ),
          );
        else controller.error(new TypeError('Connection lost.'));
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const step = await model(fetchImpl).step({
      messages: [],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step).toMatchObject({
      text: 'Часть ответа',
      toolCalls: [],
      finishReason: 'interrupted',
    });
  });

  it('requires the stream terminal marker even after a complete-looking tool call', async () => {
    const data = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c1', function: { name: 'list_templates', arguments: '{}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('data: ' + JSON.stringify(data) + '\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const step = await model(fetchImpl).step({
      messages: [],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step).toMatchObject({ toolCalls: [], finishReason: 'interrupted' });
  });
  it.each(['length', 'content_filter', null])(
    'does not expose tool calls from an unfinished native answer (%s)',
    async (finish) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        stream([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'c1', function: { name: 'list_templates', arguments: '{}' } },
                  ],
                },
              },
            ],
          },
          ...(finish ? [{ choices: [{ delta: {}, finish_reason: finish }] }] : []),
        ]),
      );
      const step = await model(fetchImpl).step({
        messages: [],
        tools,
        signal: AbortSignal.timeout(5000),
      });
      expect(step.toolCalls).toEqual([]);
    },
  );

  it('rejects malformed SSE instead of executing a call assembled around it', async () => {
    const body =
      'data: {broken\n\ndata: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { name: 'list_templates', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }) +
      '\n\ndata: [DONE]\n\n';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const step = await model(fetchImpl).step({
      messages: [],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step.toolCalls).toEqual([]);
  });

  it('does not execute a valid-looking JSON fallback truncated by the provider', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('tools unsupported', { status: 400 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  say: 'Смотрю.',
                  tool: 'list_templates',
                  arguments: '{}',
                }),
              },
              finish_reason: 'length',
            },
          ],
        }),
      );
    const step = await model(fetchImpl).step({
      messages: [],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step.toolCalls).toEqual([]);
  });
  it('streams text and assembles tool calls from their fragments', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      stream([
        { choices: [{ delta: { content: 'Смотрю ' } }] },
        { choices: [{ delta: { content: 'шаблоны.' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call-1', function: { name: 'list_templates', arguments: '{' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } },
      ]),
    );
    const deltas: string[] = [];
    const step = await model(fetchImpl).step({
      messages: [{ role: 'user', content: 'Привет' }],
      tools,
      signal: AbortSignal.timeout(5000),
      onText: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(['Смотрю ', 'шаблоны.']);
    expect(step).toMatchObject({
      text: 'Смотрю шаблоны.',
      toolCalls: [{ id: 'call-1', name: 'list_templates', arguments: '{}' }],
      truncated: false,
      inputTokens: 12,
      outputTokens: 7,
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ stream: true, tool_choice: 'auto' });
  });

  it('asks in the JSON mode once the server refuses tools, and keeps doing so', async () => {
    const json = (content: string) =>
      new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('"auto" tool choice requires --enable-auto-tool-choice', { status: 400 }),
      )
      .mockResolvedValueOnce(
        json('{"say":"Сейчас посмотрю.","tool":"list_templates","arguments":"{}"}'),
      )
      .mockResolvedValueOnce(json('{"say":"Готово.","tool":"","arguments":""}'));
    const chat = model(fetchImpl);
    const first = await chat.step({
      messages: [
        { role: 'system', content: 'You help.' },
        { role: 'user', content: 'Какие шаблоны?' },
      ],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(first.text).toBe('Сейчас посмотрю.');
    expect(first.toolCalls).toMatchObject([{ name: 'list_templates', arguments: '{}' }]);

    const second = await chat.step({
      messages: [
        { role: 'user', content: 'Какие шаблоны?' },
        { role: 'assistant', content: 'Сейчас посмотрю.', toolCalls: first.toolCalls },
        { role: 'tool', callId: first.toolCalls[0]?.id ?? '', content: '[]' },
      ],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(second).toMatchObject({ text: 'Готово.', toolCalls: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)) as {
      tools?: unknown;
      messages: { role: string; content: string }[];
    };
    expect(body.tools).toBeUndefined();
    expect(body.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
  });

  it('shows the text of a model that ignored the JSON format, and calls nothing', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('tools are not supported', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 'Просто текст.' } }] })),
      );
    const step = await model(fetchImpl).step({
      messages: [{ role: 'user', content: 'Привет' }],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(step).toMatchObject({ text: 'Просто текст.', toolCalls: [] });
  });

  it('throws a native 400 quota error before the tools fallback and does not leak the body', async () => {
    const body = JSON.stringify({
      error: {
        code: 'insufficient_quota',
        message: 'Function tools quota exhausted secret',
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 400 }));
    let thrown: unknown;
    try {
      await model(fetchImpl).step({
        messages: [{ role: 'user', content: 'Привет' }],
        tools,
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModelRequestError);
    const requestError = thrown as ModelRequestError;
    expect(requestError.failure).toEqual({ kind: 'quota-exhausted', modelId: expect.any(String) });
    expect(requestError.message).not.toContain('secret');
    expect(JSON.stringify(requestError.failure)).not.toContain('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 403 quota error and keeps the body for classification', async () => {
    const body = JSON.stringify({
      error: { code: 'token_quota_exhausted', type: 'token_quota_exhausted', message: 'secret' },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 403 }));
    let thrown: unknown;
    try {
      await model(fetchImpl).step({
        messages: [{ role: 'user', content: 'Привет' }],
        tools: [],
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModelRequestError);
    const requestError = thrown as ModelRequestError;
    expect(requestError.failure.kind).toBe('quota-exhausted');
    expect(requestError.message).not.toContain('secret');
    expect(JSON.stringify(requestError.failure)).not.toContain('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 429 quota error even with Retry-After', async () => {
    const body = JSON.stringify({ error: { type: 'insufficient_quota', message: 'secret' } });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 429, headers: { 'retry-after': '1' } }));
    let thrown: unknown;
    try {
      await model(fetchImpl).step({
        messages: [{ role: 'user', content: 'Привет' }],
        tools: [],
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModelRequestError);
    const requestError = thrown as ModelRequestError;
    expect(requestError.failure.kind).toBe('quota-exhausted');
    expect(requestError.message).not.toContain('secret');
    expect(JSON.stringify(requestError.failure)).not.toContain('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries an ordinary 429 then succeeds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('busy', { status: 429, headers: { 'retry-after': '0' } }),
        )
        .mockResolvedValueOnce(
          Response.json({
            choices: [
              {
                message: { content: '{"say":"Ок","tool":"","arguments":""}' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      const pending = model(fetchImpl).step({
        messages: [{ role: 'user', content: 'Привет' }],
        tools: [],
        signal: new AbortController().signal,
      });
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toMatchObject({ text: 'Ок' });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
