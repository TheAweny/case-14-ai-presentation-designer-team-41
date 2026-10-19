import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ledgerFetch, type AttemptLedger } from './attempt-ledger.js';
import { OpenAICompatibleProvider } from '../generation/provider.js';

function journal() {
  const trace: string[] = [];
  const intents: Parameters<AttemptLedger['begin']>[0][] = [];
  const outcomes: Parameters<AttemptLedger['end']>[1][] = [];
  const ledger: AttemptLedger = {
    async begin(intent) {
      intents.push(intent);
      trace.push('intent');
      return String(intents.length);
    },
    async end(_id, outcome) {
      outcomes.push(outcome);
      trace.push('outcome');
    },
  };
  return { trace, intents, outcomes, ledger };
}

describe('physical provider attempt journal', () => {
  it('records every compatibility send before HTTP and usage before schema validation', async () => {
    const j = journal();
    let count = 0;
    const transport: typeof fetch = async () => {
      expect(j.trace.at(-1)).toBe('intent');
      j.trace.push('http');
      count++;
      if (count === 1)
        return new Response(
          JSON.stringify({
            error: { param: 'response_format', message: 'unsupported response_format' },
          }),
          { status: 400 },
        );
      return new Response(
        JSON.stringify({
          usage: { prompt_tokens: 17, completion_tokens: 9 },
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        }),
      );
    };
    const provider = new OpenAICompatibleProvider({
      apiKey: 'private-key',
      baseUrl: 'https://provider.invalid/v1',
      model: 'model-a',
      fetchImpl: ledgerFetch(j.ledger, 'text', transport),
    });
    const schema = z.object({ ok: z.boolean() }).superRefine(() => {
      expect(j.trace.at(-1)).toBe('outcome');
    });
    expect(
      await provider.generate(
        'writer',
        'secret source text',
        {},
        schema,
        new AbortController().signal,
      ),
    ).toEqual({ ok: true });
    expect(j.intents).toHaveLength(2);
    expect(j.outcomes).toMatchObject([
      { status: 'http-error', inputTokens: null },
      { inputTokens: 17, outputTokens: 9 },
    ]);
    expect(JSON.stringify(j.intents)).not.toMatch(/private-key|secret source text/);
  });

  it('keeps invalid and truncated responses, and lost responses as unknown charges', async () => {
    const j = journal();
    const replies = [
      'broken JSON',
      JSON.stringify({
        choices: [{ finish_reason: 'length' }],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      }),
    ];
    const transport: typeof fetch = async () => {
      const body = replies.shift();
      if (body === undefined) throw new TypeError('network dropped');
      return new Response(body);
    };
    const request = ledgerFetch(j.ledger, 'text', transport);
    await request('https://provider.invalid', { body: '{"model":"x"}' });
    await request('https://provider.invalid', { body: '{"model":"x"}' });
    await expect(request('https://provider.invalid')).rejects.toThrow('network dropped');
    expect(j.outcomes.map((outcome) => outcome.status)).toEqual([
      'invalid-response',
      'truncated-response',
      'unknown-outcome',
    ]);
    expect(j.outcomes[2]).toMatchObject({ inputTokens: null, actualCost: null });
  });

  it('records denied reservations without sending and propagates persistence failure', async () => {
    const j = journal();
    const send = vi.fn<typeof fetch>();
    j.ledger.begin = async () => {
      throw new Error('budget');
    };
    await expect(ledgerFetch(j.ledger, 'text', send)('https://provider.invalid')).rejects.toThrow(
      'budget',
    );
    expect(send).not.toHaveBeenCalled();
    j.ledger.begin = async () => 'attempt';
    j.ledger.end = async () => {
      throw new Error('journal unavailable');
    };
    send.mockResolvedValue(new Response('{}'));
    await expect(ledgerFetch(j.ledger, 'text', send)('https://provider.invalid')).rejects.toThrow(
      'journal unavailable',
    );
  });

  it('streams a valid tool-only response and persists terminal usage before exposing EOF', async () => {
    const j = journal();
    const body =
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n' +
      'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const transport: typeof fetch = async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    const response = await ledgerFetch(j.ledger, 'chat', transport)('https://provider.invalid');
    expect(j.outcomes).toHaveLength(0);
    expect(await response.text()).toBe(body);
    expect(j.outcomes).toMatchObject([
      { status: 'response-received', inputTokens: 4, outputTokens: 2 },
    ]);
  });

  it('keeps missing usage unknown and calculates actual cost only from a versioned tariff', async () => {
    const j = journal();
    const send: typeof fetch = async () =>
      new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    await ledgerFetch(j.ledger, 'text', send, {
      version: '2026-10-test',
      currency: 'USD',
      inputPerMillion: 2,
      outputPerMillion: 4,
    })('https://provider.invalid', { body: '{"model":"x","max_tokens":100}' });
    expect(j.outcomes[0]?.actualCost).toBe(0.0004);
    expect(j.intents[0]?.pricingVersion).toBe('2026-10-test');
    await ledgerFetch(j.ledger, 'text', async () => new Response('{}'))('https://provider.invalid');
    expect(j.outcomes[1]).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      actualCost: null,
    });
  });
});
