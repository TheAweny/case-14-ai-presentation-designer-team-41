import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AttemptBudget } from './attempt-budget.js';
import {
  BUSY_RETRIES,
  OpenAICompatibleProvider,
  parseModelJson,
  RequestLimiter,
  retryDelay,
  RoutedTextProvider,
} from './provider.js';

const schema = z.object({ ok: z.boolean() });
const settings = {
  apiKey: 'test-secret',
  baseUrl: 'https://llm.api.cloud.yandex.net/v1',
  model: 'gpt://test-folder/qwen3.6-35b-a3b/latest',
};
const answer = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }),
  );
afterEach(() => vi.useRealTimers());

describe('Yandex OpenAI-compatible provider boundary', () => {
  it('accepts valid fenced JSON and rejects schema violations', () => {
    expect(parseModelJson('```json\n{"ok":true}\n```', schema)).toEqual({ ok: true });
    expect(() => parseModelJson('{"ok":"yes"}', schema)).toThrow();
  });
  it('finds the object in an answer that wraps it in reasoning or prose', () => {
    expect(
      parseModelJson('<think>{"ok":false} maybe</think>\n**Answer:**\n{"ok":true}\nDone.', schema),
    ).toEqual({ ok: true });
    expect(() => parseModelJson('The request is unclear.', schema)).toThrow(SyntaxError);
  });
  it('retries a request that hit its own time limit, but not a cancelled run', async () => {
    const timeout = () => Promise.reject(new DOMException('slow answer', 'TimeoutError'));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(timeout)
      .mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await expect(
      provider.generate('writer', 'instructions', {}, schema, AbortSignal.timeout(10000)),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const cancelled = new AbortController();
    const stop = vi.fn<typeof fetch>().mockImplementation(() => {
      cancelled.abort(new DOMException('run cancelled', 'TimeoutError'));
      return Promise.reject(cancelled.signal.reason);
    });
    const stopped = new OpenAICompatibleProvider({ ...settings, fetchImpl: stop });
    await expect(
      stopped.generate('writer', 'instructions', {}, schema, cancelled.signal),
    ).rejects.toThrow();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('draws again after off-schema JSON', async () => {
    const bad = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":"yes"}' }, finish_reason: 'stop' }],
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(bad).mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await expect(
      provider.generate('writer', 'instructions', {}, schema, AbortSignal.timeout(10000)),
    ).resolves.toEqual({ ok: true });
  });
  it('requires an address and a model before sending requests', () => {
    for (const field of ['baseUrl', 'model'] as const) {
      expect(() => new OpenAICompatibleProvider({ ...settings, [field]: '' })).toThrow();
    }
  });
  it('sends no authorization to a server without a key, and never follows a redirect', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({ ...settings, apiKey: '', fetchImpl });
    await provider.generate('writer', 'instructions', {}, schema, AbortSignal.timeout(1000));
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty('Authorization');
    expect(init?.redirect).toBe('error');
  });
  it('uses the configured endpoint, bearer key and model without a fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      baseUrl: settings.baseUrl + '/',
      fetchImpl,
    });
    await provider.generate('writer', 'instructions', {}, schema, AbortSignal.timeout(1000));
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(settings.baseUrl + '/chat/completions');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-secret' });
    expect(JSON.parse(String(init?.body)).model).toBe(settings.model);
  });
  it('routes a pipeline role to its assigned persisted provider', async () => {
    const fallbackFetch = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const plannerFetch = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const writerFetch = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const fallback = new OpenAICompatibleProvider({
      ...settings,
      model: 'fallback',
      fetchImpl: fallbackFetch,
    });
    const planner = new OpenAICompatibleProvider({
      ...settings,
      model: 'planner-model',
      fetchImpl: plannerFetch,
    });
    const writer = new OpenAICompatibleProvider({
      ...settings,
      model: 'writer-model',
      fetchImpl: writerFetch,
    });
    const provider = new RoutedTextProvider(
      fallback,
      new Map([
        ['planner', planner],
        ['writer', writer],
      ]),
    );

    await provider.generate('planner', '', {}, schema, AbortSignal.timeout(1000));
    await provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000));
    await provider.generate('critic', '', {}, schema, AbortSignal.timeout(1000));

    expect(JSON.parse(String(plannerFetch.mock.calls[0]?.[1]?.body)).model).toBe('planner-model');
    expect(JSON.parse(String(writerFetch.mock.calls[0]?.[1]?.body)).model).toBe('writer-model');
    expect(JSON.parse(String(fallbackFetch.mock.calls[0]?.[1]?.body)).model).toBe('fallback');
  });
  it('disables thinking and passes the output schema as strict json_schema', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await provider.generate('writer', 'instructions', {}, schema, AbortSignal.timeout(1000));
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.reasoning).toBeUndefined();
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'writer',
        strict: true,
        schema: { type: 'object', additionalProperties: false, required: ['ok'] },
      },
    });
  });
  it('does not retry unauthorized responses or expose their secret-bearing body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('test-secret', { status: 401 }));
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    const error = await provider
      .generate('writer', '', {}, schema, AbortSignal.timeout(1000))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain('test-secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('honours cancellation before making a model call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await expect(
      provider.generate('writer', '', {}, schema, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('limits combined traffic from separate runs to the shared slots', async () => {
    let active = 0;
    let peak = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return answer();
    });
    const providers = Array.from(
      { length: 2 },
      () => new OpenAICompatibleProvider({ ...settings, fetchImpl }),
    );
    await Promise.all(
      providers.flatMap((provider) =>
        Array.from({ length: 6 }, () =>
          provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000)),
        ),
      ),
    );
    expect(peak).toBe(8);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });
  it('cancels queued requests without using an HTTP slot', async () => {
    const releases: (() => void)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return answer();
    });
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    const running = Array.from({ length: 8 }, () =>
      provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000)),
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(8));
    const abort = new AbortController();
    const queued = provider.generate('writer', '', {}, schema, abort.signal);
    const rejection = expect(queued).rejects.toThrow();
    abort.abort();
    await rejection;
    releases.forEach((release) => release());
    await Promise.all(running);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });
  it('retries 429 with backoff but never changes model', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
    });
    const pending = provider.generate('writer', '', {}, schema, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.every(
        ([, init]) => JSON.parse(String(init?.body)).model === settings.model,
      ),
    ).toBe(true);
  });
  it('retries truncated answers with a bounded larger token budget', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'length' }],
          }),
        ),
      )
      .mockResolvedValueOnce(answer());
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await expect(
      provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000)),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(provider.calls[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      provider: 'llm.api.cloud.yandex.net',
    });
  });
  it('reports counts for a reasoning-only length error and leaks nothing', async () => {
    const secret = 'reasoning-secret-do-not-leak';
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { reasoning_content: secret }, finish_reason: 'length' }],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
          }),
        ),
    );
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    const error = await provider
      .generate('writer', '', {}, schema, AbortSignal.timeout(1000))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('"finish_reason":"length"');
    expect(message).toContain('"contentChars":0');
    expect(message).toContain('"reasoningChars":' + String(secret.length));
    expect(message).toContain('"attempts":3');
    expect(message).toContain('"maxTokens":10800');
    expect(message).toContain('"prompt_tokens":11');
    expect(message).not.toContain(secret);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('diagnoses empty choices without a raw payload', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 0 } }),
          ),
      );
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    const error = await provider
      .generate('writer', '', {}, schema, AbortSignal.timeout(1000))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('"finish_reason":"unknown"');
    expect(message).toContain('"contentChars":0');
    expect(message).toContain('"hasRefusal":false');
    expect(message).not.toContain('choices');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('does not accept valid JSON when finish_reason is length', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          }),
        ),
    );
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    await expect(
      provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000)),
    ).rejects.toThrow(/empty or truncated JSON/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('rejects valid JSON with a refusal and does not leak the raw secret', async () => {
    const secret = 'refusal-raw-secret';
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"ok":true}', refusal: secret }, finish_reason: 'stop' },
            ],
          }),
        ),
    );
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
    const error = await provider
      .generate('writer', '', {}, schema, AbortSignal.timeout(1000))
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('"hasRefusal":true');
    expect(message).toContain('"finish_reason":"stop"');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('busy provider', () => {
  const busyResponse = (headers: Record<string, string> = {}) =>
    new Response('', { status: 429, headers });
  const tokensOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body)).max_tokens;

  it('waits longer after each refusal, with jitter, and never less than Retry-After', () => {
    expect(retryDelay(0, null, () => 0)).toBe(500);
    expect(retryDelay(0, null, () => 1)).toBe(1000);
    expect(retryDelay(3, null, () => 0)).toBe(4000);
    expect(retryDelay(3, null, () => 1)).toBe(8000);
    expect(retryDelay(10, null, () => 1)).toBe(16000);
    expect(retryDelay(0, '5', () => 0)).toBe(5000);
    expect(retryDelay(0, '600', () => 0)).toBe(30000);
    const at = new Date(Date.now() + 7000).toUTCString();
    expect(retryDelay(0, at, () => 0)).toBeGreaterThan(5000);
    expect(retryDelay(1, 'soon', () => 0)).toBe(1000);
  });

  it('outlasts a run of refusals without raising the token budget', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>();
    for (let i = 0; i < BUSY_RETRIES; i++) fetchImpl.mockResolvedValueOnce(busyResponse());
    fetchImpl.mockResolvedValueOnce(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
    });
    const pending = provider.generate('writer', '', {}, schema, new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(BUSY_RETRIES + 1);
    const budgets = fetchImpl.mock.calls.map(([, init]) => tokensOf(init));
    expect(new Set(budgets).size).toBe(1);
  });

  it('stops HTTP retries when the shared attempt budget is exhausted', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => busyResponse());
    const budget = new AttemptBudget(1);
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
      attemptBudget: budget,
    });
    const pending = provider
      .generate('writer', '', {}, schema, new AbortController().signal)
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/after 1 retries/);
    expect((error as Error).message).toMatch(/shared attempt budget is exhausted/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
    expect(budget.snapshot()).toEqual({ max: 1, used: 1, remaining: 0 });
  });

  it('does not retry malformed JSON once the shared attempt budget is spent', async () => {
    const bad = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":"yes"}' }, finish_reason: 'stop' }],
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(bad);
    const budget = new AttemptBudget(1);
    expect(budget.tryTake()).toBe(true);
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
      attemptBudget: budget,
    });
    await expect(
      provider.generate('writer', '', {}, schema, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(0);
  });

  it('keeps the busy-retry cap when no attempt budget is passed', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => busyResponse());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
    });
    const pending = provider
      .generate('writer', '', {}, schema, new AbortController().signal)
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Model API HTTP 429 .* after 5 retries/);
    expect((error as Error).message).not.toMatch(/attempt budget/);
    expect(fetchImpl).toHaveBeenCalledTimes(BUSY_RETRIES + 1);
  });

  it('gives up after the retry budget and says how many times it asked', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => busyResponse());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
    });
    const pending = provider
      .generate('writer', '', {}, schema, new AbortController().signal)
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Model API HTTP 429 .* after 5 retries/);
    expect(fetchImpl).toHaveBeenCalledTimes(BUSY_RETRIES + 1);
  });

  it('halves the pool once for refusals that arrive together and holds new requests', async () => {
    vi.useFakeTimers();
    const limiter = new RequestLimiter(8);
    limiter.throttle(2000);
    limiter.throttle(2000);
    limiter.throttle(3000);
    expect(limiter.capacity).toBe(4);

    let granted = false;
    const waiting = limiter.acquire(new AbortController().signal).then((release) => {
      granted = true;
      return release;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(granted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    (await waiting)();
    expect(granted).toBe(true);
  });

  it('grows the pool back by one after a run of answers as long as the pool', () => {
    vi.useFakeTimers();
    const limiter = new RequestLimiter(8);
    limiter.throttle(0);
    expect(limiter.capacity).toBe(4);
    for (let i = 0; i < 3; i++) limiter.succeeded();
    expect(limiter.capacity).toBe(4);
    limiter.succeeded();
    expect(limiter.capacity).toBe(5);
    for (let i = 0; i < 100; i++) limiter.succeeded();
    expect(limiter.capacity).toBe(8);
  });

  it('brings all three variants home from a provider that takes two requests at once', async () => {
    vi.useFakeTimers();
    const quota = 2;
    let active = 0;
    let refused = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      if (active >= quota) {
        refused++;
        return busyResponse({ 'retry-after': '1' });
      }
      active++;
      await new Promise((resolve) => setTimeout(resolve, 200));
      active--;
      return answer();
    });
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      limiter: new RequestLimiter(8),
    });
    // Three variants writing four slides each, all at once.
    const variants = Array.from({ length: 3 }, () =>
      Promise.all(
        Array.from({ length: 4 }, () =>
          provider.generate('writer', '', {}, schema, new AbortController().signal),
        ),
      ),
    );
    const settled = Promise.allSettled(variants);
    await vi.runAllTimersAsync();
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(refused).toBeGreaterThan(0);
  });
});

describe('a model that ignores structured output', () => {
  const answerFormat = {
    format: 'Answer in JSON by this schema:\n{{schema}}',
    repair: 'Fix these problems:\n{{problems}}',
  };
  const reply = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  const bodyOf = (call: unknown[] | undefined) =>
    JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as {
      messages: { role: string; content: string }[];
    };

  it('gets the schema of its answer in the instructions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      answerFormat,
      limiter: new RequestLimiter(8),
    });
    await provider.generate('writer', 'Write a slide.', {}, schema, AbortSignal.timeout(1000));
    const system = bodyOf(fetchImpl.mock.calls[0]).messages[0]?.content ?? '';
    expect(system.startsWith('Write a slide.\n\nAnswer in JSON by this schema:\n{')).toBe(true);
    expect(system).toContain('"required":["ok"]');
  });

  it('is asked once to repair an answer off the schema, with what is wrong', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(reply('{"title":"Итоги","points":[]}'))
      .mockResolvedValueOnce(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      answerFormat,
      limiter: new RequestLimiter(8),
    });
    await expect(
      provider.generate('writer', 'Write.', { slide: 1 }, schema, AbortSignal.timeout(1000)),
    ).resolves.toEqual({ ok: true });
    const repair = bodyOf(fetchImpl.mock.calls[1]).messages;
    expect(repair.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repair[2]?.content).toBe('{"title":"Итоги","points":[]}');
    expect(repair[3]?.content).toMatch(/^Fix these problems:\n- ok: /);
  });

  it('draws afresh when the repair misses too, and gives up after the budget', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => reply('{"wrong":1}'));
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      answerFormat,
      limiter: new RequestLimiter(8),
    });
    await expect(
      provider.generate('writer', 'Write.', {}, schema, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // The first retry repairs, the second draws again without the bad answer.
    expect(bodyOf(fetchImpl.mock.calls[1]).messages).toHaveLength(4);
    expect(bodyOf(fetchImpl.mock.calls[2]).messages).toHaveLength(2);
  });

  it('sends the headers of its connection, and never lets them replace the key', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer());
    const provider = new OpenAICompatibleProvider({
      ...settings,
      fetchImpl,
      headers: { 'Project-ID': 'p-1', Authorization: 'Bearer forged' },
      limiter: new RequestLimiter(8),
    });
    await provider.generate('writer', '', {}, schema, AbortSignal.timeout(1000));
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      'Project-ID': 'p-1',
      Authorization: 'Bearer test-secret',
    });
  });
});
