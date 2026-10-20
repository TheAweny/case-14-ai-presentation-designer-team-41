import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  GenerationProvider,
  OpenAICompatibleChatModel,
  ledgerFetch,
  type AttemptLedger,
} from '@lct/pipeline';
import { modelTransport } from './model-transport.js';

describe('saved connection protocol routing', () => {
  it('preserves the transport for existing compatible connections', () => {
    const send = vi.fn<typeof fetch>();
    expect(modelTransport({}, send)).toBe(send);
    expect(modelTransport({ protocol: 'openai-compatible' }, send)).toBe(send);
  });

  it('uses native Messages for writer JSON and journals physical native tokens', async () => {
    const outcomes: unknown[] = [];
    const ledger: AttemptLedger = {
      begin: async () => 'attempt',
      end: async (_id, outcome) => {
        outcomes.push(outcome);
      },
    };
    const send = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
      const headers = new Headers(init?.headers);
      expect(headers.get('x-api-key')).toBe('private-key');
      expect(headers.has('authorization')).toBe(false);
      const request = JSON.parse(String(init?.body));
      expect(request).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 8192 });
      expect(request).not.toHaveProperty('temperature');
      expect(request).not.toHaveProperty('top_p');
      return Response.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 8 },
      });
    });
    const provider = new GenerationProvider({
      apiKey: 'private-key',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-haiku-5-5',
      fetchImpl: modelTransport({ protocol: 'anthropic' }, ledgerFetch(ledger, 'generation', send)),
    });
    provider.setAgentGeneration('writer', { temperature: 0.3, topP: 0.9, maxOutputTokens: 8192 });
    await expect(
      provider.generate(
        'writer',
        'registry instruction',
        {},
        z.object({ ok: z.boolean() }),
        AbortSignal.timeout(5000),
      ),
    ).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(outcomes).toMatchObject([
      { inputTokens: 40, outputTokens: 8, status: 'response-received' },
    ]);
  });

  it('supports a chat tool request and its result on the same saved connection', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.tools[0]).toMatchObject({ name: 'inspect', input_schema: { type: 'object' } });
      const second = send.mock.calls.length === 2;
      if (second) expect(JSON.stringify(request.messages)).toContain('tool_result');
      return Response.json({
        id: second ? 'msg_b' : 'msg_a',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: second
          ? [{ type: 'text', text: 'Готово' }]
          : [{ type: 'tool_use', id: 'toolu_a', name: 'inspect', input: { id: 'slide-1' } }],
        stop_reason: second ? 'end_turn' : 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    });
    const model = new OpenAICompatibleChatModel({
      apiKey: 'key',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-haiku-5-5',
      jsonModeInstructions: '',
      fetchImpl: modelTransport({ protocol: 'anthropic' }, send),
    });
    const tools = [
      {
        name: 'inspect',
        description: 'Inspect a slide',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
      },
    ];
    const first = await model.step({
      messages: [{ role: 'user', content: 'Проверь' }],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(first).toMatchObject({
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'toolu_a', name: 'inspect', arguments: '{"id":"slide-1"}' }],
    });
    const second = await model.step({
      messages: [
        { role: 'user', content: 'Проверь' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', callId: 'toolu_a', content: '{"ok":true}' },
      ],
      tools,
      signal: AbortSignal.timeout(5000),
    });
    expect(second).toMatchObject({ finishReason: 'stop', text: 'Готово' });
  });
});
