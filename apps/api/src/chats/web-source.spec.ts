import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWebSource, WebSourceError, type WebSourceResponse } from './web-source.js';

afterEach(() => vi.useRealTimers());

const html = [
  '<!doctype html><html><head><title>Отчёт &amp; план</title>',
  '<script>alert(document.cookie)</script>',
  '<style>body{background:url(javascript:alert(1))}</style>',
  '</head><body>',
  '<!-- rm -rf / -->',
  '<p>Hello &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p>',
  '</body></html>',
].join('');

function page(
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' },
  status = 200,
) {
  let disposed = false;
  const bytes = new TextEncoder().encode(body);
  const response: WebSourceResponse = {
    status,
    headers,
    body: {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          async next() {
            if (sent) return { done: true as const, value: undefined };
            sent = true;
            return { done: false as const, value: bytes };
          },
          async return() {
            disposed = true;
            return { done: true as const, value: undefined };
          },
        };
      },
    },
  };
  return { response, disposed: () => disposed };
}

describe('fetchWebSource', () => {
  it('pins the first public address and keeps escaped markup as text', async () => {
    const seen: string[] = [];
    const document = page(html);
    const result = await fetchWebSource(
      'https://example.org/report',
      new AbortController().signal,
      {
        resolve: async () => ['8.8.8.8', '1.1.1.1'],
        transport: {
          async request(url, pinnedAddress) {
            seen.push(pinnedAddress + ' ' + url.hostname);
            return document.response;
          },
        },
        now: () => new Date('2026-10-18T00:00:00.000Z'),
      },
    );
    expect(seen).toEqual(['8.8.8.8 example.org']);
    expect(result.title).toBe('Отчёт & план');
    expect(result.text).toBe('Hello & <script>alert(1)</script>');
    expect(result.text).not.toContain('document.cookie');
    expect(result.text).not.toContain('rm -rf');
    expect(result.contentHash).toBe(createHash('sha256').update(result.text, 'utf8').digest('hex'));
    expect(result.trust).toBe('unverified');
    expect(result.truncated).toBe(false);
    expect(result.nextOffset).toBeNull();
  });

  it('rejects a name when any DNS answer is private or mapped', async () => {
    const transport = vi.fn();
    await expect(
      fetchWebSource('https://example.org/a', new AbortController().signal, {
        resolve: async () => ['8.8.8.8', '10.1.1.1'],
        transport: { request: transport },
      }),
    ).rejects.toMatchObject({ kind: 'blocked' });
    await expect(
      fetchWebSource('https://example.org/a', new AbortController().signal, {
        resolve: async () => ['::ffff:7f00:1'],
        transport: { request: transport },
      }),
    ).rejects.toMatchObject({ kind: 'blocked' });
    await expect(
      fetchWebSource('http://[::ffff:7f00:1]/metadata', new AbortController().signal, {
        transport: { request: transport },
      }),
    ).rejects.toMatchObject({ kind: 'blocked' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('disposes a redirect body and refuses the private next hop', async () => {
    const first = page('ignore me', { location: 'http://evil.example/secret' }, 302);
    const transport = vi.fn(async () => first.response);
    await expect(
      fetchWebSource('https://example.org/start', new AbortController().signal, {
        resolve: async (host) => (host === 'example.org' ? ['8.8.8.8'] : ['10.0.0.5']),
        transport: { request: transport },
      }),
    ).rejects.toMatchObject({ kind: 'blocked' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(first.disposed()).toBe(true);
  });

  it('stops an oversized stream', async () => {
    let reads = 0;
    let disposed = false;
    await expect(
      fetchWebSource('https://example.org/big', new AbortController().signal, {
        resolve: async () => ['8.8.8.8'],
        transport: {
          async request() {
            return {
              status: 200,
              headers: { 'content-type': 'text/plain' },
              body: {
                [Symbol.asyncIterator]() {
                  return {
                    async next() {
                      reads += 1;
                      return { done: false as const, value: new Uint8Array(600_000) };
                    },
                    async return() {
                      disposed = true;
                      return { done: true as const, value: undefined };
                    },
                  };
                },
              },
            };
          },
        },
      }),
    ).rejects.toBeInstanceOf(WebSourceError);
    expect(reads).toBe(2);
    expect(disposed).toBe(true);
  });

  it('times out and aborts an uncooperative transport', async () => {
    vi.useFakeTimers();
    const hanging = () => new Promise<WebSourceResponse>(() => undefined);
    const client = (signal: AbortSignal, timeoutMs?: number) =>
      fetchWebSource('https://example.org/slow', signal, {
        timeoutMs,
        resolve: async () => ['8.8.8.8'],
        transport: { request: hanging },
      });
    const timed = client(new AbortController().signal, 20).then(
      () => 'ok',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(timed).resolves.toMatchObject({ kind: 'timeout' });

    const controller = new AbortController();
    const cancelled = client(controller.signal, 1000).then(
      () => 'ok',
      (error: unknown) => error,
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    await expect(cancelled).resolves.toMatchObject({ kind: 'aborted' });
  });

  it('returns an exact offset and the hash of the full text', async () => {
    const full = '0123456789';
    const hash = createHash('sha256').update(full, 'utf8').digest('hex');
    const document = page(full, { 'content-type': 'text/plain' });
    const result = await fetchWebSource('https://example.org/plain', new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      transport: {
        async request() {
          return document.response;
        },
      },
      offset: 4,
      maxChars: 4,
      expectedContentHash: hash,
    });
    expect(result.text).toBe('4567');
    expect(result.offset).toBe(4);
    expect(result.nextOffset).toBe(8);
    expect(result.truncated).toBe(true);
    expect(result.contentHash).toBe(hash);
    await expect(
      fetchWebSource('https://example.org/plain', new AbortController().signal, {
        resolve: async () => ['8.8.8.8'],
        transport: {
          async request() {
            return page(full, { 'content-type': 'text/plain' }).response;
          },
        },
        expectedContentHash: 'f'.repeat(64),
      }),
    ).rejects.toMatchObject({ kind: 'hash-mismatch' });
  });

  it('keeps the JSON under the output budget without splitting a surrogate', async () => {
    const emoji = '😀';
    const full = 'a'.repeat(10) + emoji + 'b'.repeat(20);
    const cut = await fetchWebSource('https://example.org/emoji', new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      transport: {
        async request() {
          return page(full, { 'content-type': 'text/plain' }).response;
        },
      },
      maxChars: 11,
    });
    expect(cut.text).toBe('a'.repeat(10));
    expect(cut.nextOffset).toBe(10);
    expect(cut.truncated).toBe(true);

    const longUrl = 'https://example.org/' + 'x'.repeat(1800);
    const bulky = await fetchWebSource(longUrl, new AbortController().signal, {
      resolve: async () => ['8.8.8.8'],
      transport: {
        async request() {
          return page('y'.repeat(8000), { 'content-type': 'text/plain' }).response;
        },
      },
      maxChars: 8000,
    });
    expect(JSON.stringify(bulky).length).toBeLessThan(10000);
    expect(bulky.truncated).toBe(true);
    expect(bulky.nextOffset).toBe(bulky.offset + bulky.text.length);
  });
});
