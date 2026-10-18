import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSearch, WebSearchError } from './web-search.js';

afterEach(() => vi.useRealTimers());

const hit = {
  url: 'https://example.org/report',
  title: 'Отчёт',
  content: 'Источник, который ещё нужно прочитать.',
  publishedDate: '2026-10-18',
};

describe('web search adapter', () => {
  it('keeps a numeric content length and a calendar day', async () => {
    const body = JSON.stringify({ results: [hit] });
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve: async () => ['8.8.8.8'],
      fetch: async () =>
        new Response(body, { headers: { 'content-length': String(Buffer.byteLength(body)) } }),
    });
    const answer = await client.search('дата', new AbortController().signal);
    expect(answer.results[0]?.publishedAt).toBe('2026-10-18');
  });

  it('drops a bracketed loopback address before DNS', async () => {
    const resolve = vi.fn(async () => ['8.8.8.8']);
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve,
      fetch: async () => Response.json({ results: [{ ...hit, url: 'http://[::1]/metadata' }] }),
    });
    const answer = await client.search('отчёт', new AbortController().signal);
    expect(answer.results).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects with timeout when the operation never settles', async () => {
    vi.useFakeTimers();
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      timeoutMs: 20,
      fetch: () => new Promise(() => undefined),
    });
    const pending = client.search('отчёт', new AbortController().signal);
    const settled = pending.then(
      () => 'ok',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(settled).resolves.toMatchObject({ kind: 'timeout' });
    await expect(settled).resolves.toBeInstanceOf(WebSearchError);
  });

  it('rejects immediately when the caller aborts a hanging fetch', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      timeoutMs: 1000,
      fetch: () => new Promise<Response>(() => undefined),
    });
    const pending = client.search('отчёт', controller.signal);
    const settled = pending.then(
      () => 'ok',
      (error: unknown) => error,
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(settled).resolves.toMatchObject({ kind: 'aborted' });
  });
});
