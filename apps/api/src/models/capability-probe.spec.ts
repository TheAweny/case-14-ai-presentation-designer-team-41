import { describe, expect, it, vi } from 'vitest';
import { probeReasoning } from './capability-probe.js';
import type { ResolvedModel } from './model-settings.service.js';

const model: ResolvedModel = {
  connectionId: 'c',
  baseUrl: 'https://models.example.test/v1',
  apiKey: 'key',
  model: 'any-name-at-all',
  headers: { 'Project-ID': 'p' },
};

function server(answer: () => Response) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // One token at most, with a depth no server knows: free where the field is read.
    expect(body.max_tokens).toBe(1);
    expect(body.reasoning_effort).toBe('lct-probe-no-such-effort');
    expect(new Headers(init?.headers).get('Project-ID')).toBe('p');
    return answer();
  }) as unknown as typeof fetch;
}

describe('probeReasoning', () => {
  it('finds a server that reads reasoning_effort by its refusal of a made-up depth', async () => {
    const refused = server(
      () =>
        new Response('unsupported reasoning effort: "lct-probe-no-such-effort"', { status: 400 }),
    );
    await expect(probeReasoning(model, 'ok', refused)).resolves.toEqual({
      known: true,
      value: { toggle: 'reasoning-effort', levels: true },
    });
    const listed = server(
      () =>
        new Response("Invalid value. Supported values are: 'low', 'medium', 'high'.", {
          status: 400,
        }),
    );
    await expect(probeReasoning(model, 'ok', listed)).resolves.toMatchObject({
      known: true,
      value: { levels: true },
    });
  });

  it('offers nothing where the field itself is refused or simply dropped', async () => {
    const noField = server(
      () =>
        new Response(
          "Unsupported parameter: 'reasoning_effort' is not supported with this model.",
          { status: 400 },
        ),
    );
    await expect(probeReasoning(model, 'ok', noField)).resolves.toEqual({
      known: true,
      value: null,
    });
    const dropped = server(() => Response.json({ choices: [{ message: { content: 'o' } }] }));
    await expect(probeReasoning(model, 'ok', dropped)).resolves.toEqual({
      known: true,
      value: null,
    });
  });

  it('settles nothing when the account or the moment is to blame', async () => {
    for (const status of [402, 429, 503]) {
      const failing = server(() => new Response('', { status }));
      await expect(probeReasoning(model, 'ok', failing)).resolves.toEqual({ known: false });
    }
  });
});
