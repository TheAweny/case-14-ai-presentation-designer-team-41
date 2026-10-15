import { describe, expect, it, vi } from 'vitest';
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
  it.each(['length', 'content_filter', null])(
    'does not expose tool calls from an unfinished native answer (%s)',
    async (finish) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
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
});
