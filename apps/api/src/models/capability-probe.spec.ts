import { describe, expect, it, vi } from 'vitest';
import { probeReasoning, probeSpeech, reasoningAmount } from './capability-probe.js';
import type { ResolvedModel } from './model-settings.service.js';

const model: ResolvedModel = {
  connectionId: 'c',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'key',
  model: 'any-name-at-all',
  headers: { 'Project-ID': 'p' },
};

/** An answer that thought for `tokens` reasoning tokens, or did not think at all. */
const answer = (tokens: number) =>
  Response.json({
    choices: [{ message: { content: '400' } }],
    usage: { completion_tokens_details: { reasoning_tokens: tokens } },
  });

/** A fake server: `behave` maps the request body to the reasoning it would do, or a status. */
function server(behave: (body: Record<string, unknown>) => number | Response) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('Project-ID')).toBe('p');
    const result = behave(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return typeof result === 'number' ? answer(result) : result;
  }) as unknown as typeof fetch;
}

const kwargs = (body: Record<string, unknown>) =>
  (body.chat_template_kwargs as { enable_thinking?: boolean } | undefined)?.enable_thinking;

const effortOf = (body: Record<string, unknown>) => body.reasoning_effort as string | undefined;
const unknownEffort = (body: Record<string, unknown>) => {
  const effort = effortOf(body);
  return effort !== undefined && !['none', 'low', 'medium', 'high'].includes(effort);
};
const refuse = () => new Response('unsupported reasoning effort', { status: 400 });

describe('probeReasoning', () => {
  it('finds the enable_thinking switch when only "on" thinks', async () => {
    const fetchImpl = server((body) => (kwargs(body) === true ? 600 : 0));
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: 'enable-thinking', levels: false },
    });
  });

  it('gives a depth and a switch when the provider reads the field and none stops thinking', async () => {
    // As Claude behind a gateway: thinks on its own and at a depth, not with none.
    const fetchImpl = server((body) =>
      unknownEffort(body) ? refuse() : effortOf(body) === 'none' ? 0 : effortOf(body) ? 650 : 640,
    );
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: 'reasoning-effort', levels: true },
    });
  });

  it('gives only a depth when none does not stop the thinking', async () => {
    // As GPT-6.1 behind the same gateway: none is taken but the model still thinks.
    const tokens: Record<string, number> = { low: 81, high: 383, none: 246 };
    const fetchImpl = server((body) =>
      unknownEffort(body) ? refuse() : (tokens[effortOf(body) ?? ''] ?? 83),
    );
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: null, levels: true },
    });
  });

  it('offers nothing when the provider takes any value, a made-up one too', async () => {
    const fetchImpl = server((body) => (effortOf(body) === 'high' ? 1100 : 900));
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: null, levels: false },
    });
  });

  it('offers nothing when the fields are taken but the model never thinks', async () => {
    const fetchImpl = server((body) => (unknownEffort(body) ? refuse() : 3));
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: null, levels: false },
    });
  });

  it('does not count working spelled out in the answer as thinking mode', async () => {
    const fetchImpl = server((body) =>
      kwargs(body) === false
        ? Response.json({
            choices: [{ message: { content: `Step by step: ${'x'.repeat(4000)} so 368` } }],
            usage: { completion_tokens: 2600 },
          })
        : 3,
    );
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({
      known: true,
      value: { toggle: null, levels: false },
    });
  });

  it('moves to max_completion_tokens when the server asks for it', async () => {
    const fetchImpl = server((body) =>
      'max_tokens' in body
        ? new Response('Unsupported parameter: max_tokens', { status: 400 })
        : unknownEffort(body)
          ? refuse()
          : 300,
    );
    const found = await probeReasoning(model, 'q', fetchImpl);
    expect(found).toMatchObject({ known: true, value: { levels: true } });
  });

  it('stores nothing when the server is busy or down', async () => {
    const fetchImpl = server(() => new Response('slow down', { status: 429 }));
    await expect(probeReasoning(model, 'q', fetchImpl)).resolves.toEqual({ known: false });
  });
});

describe('reasoningAmount', () => {
  it('reads reasoning text when the server reports no token count', () => {
    expect(reasoningAmount({ choices: [{ message: { reasoning_content: 'a'.repeat(40) } }] })).toBe(
      10,
    );
    expect(reasoningAmount({ choices: [{ message: { content: '<think>abcd</think>4' } }] })).toBe(
      1,
    );
    expect(reasoningAmount({ choices: [{ message: { content: '4' } }] })).toBe(0);
  });
});

describe('probeSpeech', () => {
  it('knows a model transcribes when it answers with text', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://models.example.test/v1/audio/transcriptions');
      return Response.json({ text: '' });
    }) as unknown as typeof fetch;
    await expect(probeSpeech(model, fetchImpl)).resolves.toEqual({ known: true, value: true });
  });

  it('knows a chat model does not, and leaves a busy server unsettled', async () => {
    const refused = vi.fn(async () => new Response('not a speech model', { status: 400 }));
    await expect(probeSpeech(model, refused as unknown as typeof fetch)).resolves.toEqual({
      known: true,
      value: false,
    });
    const busy = vi.fn(async () => new Response('', { status: 503 }));
    await expect(probeSpeech(model, busy as unknown as typeof fetch)).resolves.toEqual({
      known: false,
    });
  });
});
