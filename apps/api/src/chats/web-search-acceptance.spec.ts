import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSearch } from './web-search.js';

afterEach(() => vi.useRealTimers());

const hit = {
  url: 'https://example.org/report',
  title: 'Отчёт',
  content: 'Источник, который ещё нужно прочитать.',
  publishedDate: '2026-10-18',
};
const publicResolve = async () => ['8.8.8.8'];

describe('independent search adapter counterexamples', () => {
  it('accepts an ordinary numeric content length and retains a supplied calendar date', async () => {
    const body = JSON.stringify({ results: [hit], unresponsive_engines: [] });
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve: publicResolve,
      fetch: async () =>
        new Response(body, {
          headers: {
            'content-length': String(Buffer.byteLength(body)),
            'content-type': 'application/json',
          },
        }),
    });
    const result = await client.search('дата отчёта', new AbortController().signal);
    expect(result.results[0]).toMatchObject({ url: hit.url, publishedAt: '2026-10-18' });
    expect(result.trust).toBe('search-results-not-evidence');
  });

  it('never resolves a bracketed loopback literal as if it were a public hostname', async () => {
    const resolve = vi.fn(publicResolve);
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve,
      fetch: async () => Response.json({ results: [{ ...hit, url: 'http://[::1]/metadata' }] }),
    });
    const result = await client.search('отчёт', new AbortController().signal);
    expect(result.results).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects private IPv4 hidden in a mapped IPv6 literal or DNS answer', async () => {
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve: async () => ['::ffff:7f00:1'],
      fetch: async () =>
        Response.json({ results: [{ ...hit, url: 'http://[::ffff:7f00:1]/metadata' }, hit] }),
    });
    expect((await client.search('отчёт', new AbortController().signal)).results).toEqual([]);
  });

  for (const phase of ['fetch', 'dns'] as const) {
    it(`enforces the whole-operation deadline when ${phase} ignores cancellation`, async () => {
      vi.useFakeTimers();
      const client = createWebSearch({
        baseUrl: 'http://search:8080',
        timeoutMs: 20,
        fetch:
          phase === 'fetch'
            ? () => new Promise<Response>(() => undefined)
            : async () => Response.json({ results: [hit] }),
        resolve:
          phase === 'dns' ? () => new Promise<readonly string[]>(() => undefined) : publicResolve,
      });
      let settled = false;
      let failure: unknown;
      void client.search('отчёт', new AbortController().signal).then(
        () => {
          settled = true;
        },
        (error: unknown) => {
          settled = true;
          failure = error;
        },
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(true);
      expect(failure).toMatchObject({ kind: 'timeout' });
    });
  }

  it('settles immediately when the caller cancels an uncooperative request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      timeoutMs: 1000,
      fetch: () => new Promise<Response>(() => undefined),
    });
    let failure: unknown;
    void client.search('отчёт', controller.signal).catch((error: unknown) => {
      failure = error;
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toMatchObject({ kind: 'aborted' });
  });

  it('keeps provider diagnostics within the structured tool output budget', async () => {
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve: publicResolve,
      fetch: async () =>
        Response.json({
          results: [hit],
          unresponsive_engines: Array.from({ length: 100 }, (_, i) => [
            `engine-${i}-${'x'.repeat(500)}`,
            'timeout',
          ]),
        }),
    });
    const result = await client.search('отчёт', new AbortController().signal);
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result).length).toBeLessThan(10000);
  });

  it('bounds the complete answer even when every individual result fits its own field limits', async () => {
    const client = createWebSearch({
      baseUrl: 'http://search:8080',
      resolve: publicResolve,
      fetch: async () =>
        Response.json({
          results: Array.from({ length: 8 }, (_, i) => ({
            ...hit,
            url: `https://example.org/${i}/${'x'.repeat(1750)}`,
            title: 'Заголовок'.repeat(40),
            content: 'Описание'.repeat(80),
          })),
        }),
    });
    const result = await client.search('отчёт', new AbortController().signal, 8);
    expect(result.results.length).toBeGreaterThan(0);
    expect(JSON.stringify(result).length).toBeLessThan(10000);
    if (result.results.length < 8) expect(result.complete).toBe(false);
  });
});
