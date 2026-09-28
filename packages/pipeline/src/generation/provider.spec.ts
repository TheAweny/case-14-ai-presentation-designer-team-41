import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider, parseModelJson, RoutedTextProvider } from './provider.js';

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
    const provider = new OpenAICompatibleProvider({ ...settings, fetchImpl });
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
});
