import { describe, expect, it } from 'vitest';
import { openRouterReasoning, readCompletion } from './provider.js';

const sse = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode(lines.join('\n'));
        // Split mid-line, as the network does.
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

describe('a streamed completion read as one answer', () => {
  it('joins the deltas and keeps the finish reason and usage', async () => {
    const data = await readCompletion(
      sse([
        'data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}',
        ': keep-alive',
        'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
        'data: [DONE]',
        '',
      ]),
    );
    expect(data.choices?.[0]?.message?.content).toBe('{"a":1}');
    expect(data.choices?.[0]?.finish_reason).toBe('stop');
    expect(data.usage).toEqual({ prompt_tokens: 5, completion_tokens: 2 });
  });

  it('reads a server that ignored stream and answered in one piece', async () => {
    const data = await readCompletion(
      Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    );
    expect(data.choices?.[0]?.message?.content).toBe('ok');
  });
});

describe('thinking on OpenRouter', () => {
  it('is switched off unless the person asked for it, and only there', () => {
    expect(openRouterReasoning('openrouter.ai', false)).toEqual({ reasoning: { enabled: false } });
    expect(openRouterReasoning('openrouter.ai', true)).toEqual({});
    expect(openRouterReasoning('api.example.com', false)).toEqual({});
  });
});
