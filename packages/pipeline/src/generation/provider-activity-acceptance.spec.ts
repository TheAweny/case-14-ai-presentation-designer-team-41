import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  OpenAICompatibleProvider,
  RequestLimiter,
  RoutedTextProvider,
  type AgentActivity,
} from './provider.js';

const answer = () =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
    }),
  );

describe('independent generation activity acceptance', () => {
  it('keeps concurrent real role tasks distinct across a shared routed provider without exposing payloads', async () => {
    const events: AgentActivity[] = [];
    const pending: (() => void)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await new Promise<void>((resolve) => pending.push(resolve));
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
        }),
      );
    });
    const provider = new OpenAICompatibleProvider({
      apiKey: 'private-key-never-public',
      baseUrl: 'https://model.example.org/v1',
      model: 'recorded',
      fetchImpl,
      onActivity: (event) => events.push(structuredClone(event)),
    });
    const routed = new RoutedTextProvider(
      provider,
      new Map([
        ['planner', provider],
        ['writer', provider],
      ]),
    );
    const work = ['planner', 'writer', 'writer'].map((role) =>
      routed.generate(
        role,
        'private-instructions-never-public',
        { privateBrief: 'private-input-never-public' },
        z.object({ ok: z.boolean() }),
        new AbortController().signal,
      ),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    const starts = events.filter((event) => event.status === 'running');
    expect(starts.map((event) => event.name)).toEqual(['planner', 'writer', 'writer']);
    expect(new Set(starts.map((event) => event.id)).size).toBe(3);
    pending.forEach((resolve) => resolve());
    await expect(Promise.all(work)).resolves.toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    for (const start of starts) {
      const pair = events.filter((event) => event.id === start.id);
      expect(pair.map((event) => event.status)).toEqual(['running', 'done']);
      expect(pair[1]?.finishedAt).toBeGreaterThanOrEqual(start.startedAt);
    }
    expect(JSON.stringify(events)).not.toContain('private-');
    expect(provider.calls).toHaveLength(3);
  });

  it('does not invent an active job for a request already cancelled by its caller', async () => {
    const events: AgentActivity[] = [];
    const fetchImpl = vi.fn<typeof fetch>();
    const control = new AbortController();
    control.abort(new Error('cancelled'));
    const provider = new OpenAICompatibleProvider({
      apiKey: '',
      baseUrl: 'https://model.example.org/v1',
      model: 'recorded',
      fetchImpl,
      onActivity: (event) => events.push(event),
    });
    await expect(
      provider.generate('writer', 'fixture', {}, z.object({ ok: z.boolean() }), control.signal),
    ).rejects.toThrow('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('returns the model answer when the activity listener throws', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({
      apiKey: 'private-key-never-public',
      baseUrl: 'https://model.example.org/v1',
      model: 'recorded',
      fetchImpl,
      onActivity: () => {
        throw new Error('listener failed');
      },
    });
    await expect(
      provider.generate(
        'critic',
        'private-instructions-never-public',
        { privateBrief: 'private-input-never-public' },
        z.object({ ok: z.boolean() }),
        new AbortController().signal,
      ),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(provider.calls).toEqual([
      expect.objectContaining({ agent: 'critic', provider: 'model.example.org' }),
    ]);
  });

  it('keeps a busy retry on the same agent task', async () => {
    vi.useFakeTimers();
    try {
      const events: AgentActivity[] = [];
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
        .mockResolvedValueOnce(answer());
      const provider = new OpenAICompatibleProvider({
        apiKey: 'private-key-never-public',
        baseUrl: 'https://model.example.org/v1',
        model: 'recorded',
        fetchImpl,
        limiter: new RequestLimiter(4),
        onActivity: (event) => events.push({ ...event }),
      });
      const pending = provider.generate(
        'writer',
        'private-instructions-never-public',
        { privateBrief: 'private-input-never-public' },
        z.object({ ok: z.boolean() }),
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(events.map((event) => event.status)).toEqual(['running', 'done']);
      expect(new Set(events.map((event) => event.id)).size).toBe(1);
      expect(events.every((event) => event.name === 'writer')).toBe(true);
      expect(JSON.stringify(events)).not.toContain('private-');
    } finally {
      vi.useRealTimers();
    }
  });
});
