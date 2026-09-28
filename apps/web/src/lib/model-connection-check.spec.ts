import { describe, expect, it, vi } from 'vitest';
import {
  checkModelConnection,
  parseModelsResponse,
  unreachableDetail,
} from './model-connection-check';

const NOW = new Date('2026-09-26T10:00:00.000Z');
const now = () => NOW;

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status }),
  ) as unknown as typeof fetch;
}

describe('parseModelsResponse', () => {
  it('takes ids from the OpenAI list format, in server order, without repeats', () => {
    expect(
      parseModelsResponse({
        object: 'list',
        data: [
          { id: 'qwen2.5:7b', object: 'model', owned_by: 'library' },
          { id: 'llava:13b' },
          { id: 'qwen2.5:7b' },
          { id: '  ' },
        ],
      }),
    ).toEqual(['qwen2.5:7b', 'llava:13b']);
  });

  it('accepts an empty list', () => {
    expect(parseModelsResponse({ data: [] })).toEqual([]);
  });

  it('rejects anything that is not a model list', () => {
    expect(parseModelsResponse({ models: [{ name: 'x' }] })).toBeNull();
    expect(parseModelsResponse({ data: [{ name: 'x' }] })).toBeNull();
    expect(parseModelsResponse('<html>')).toBeNull();
    expect(parseModelsResponse(null)).toBeNull();
  });
});

describe('unreachableDetail', () => {
  it('reads the system error code Node puts into cause', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(unreachableDetail(error)).toBe('ECONNREFUSED');
  });

  it('gives nothing when there is no code', () => {
    expect(unreachableDetail(new TypeError('fetch failed'))).toBeNull();
    expect(unreachableDetail('boom')).toBeNull();
  });
});

describe('checkModelConnection', () => {
  it('lists models and sends the key as a bearer token', async () => {
    const fetchMock = respond(200, { object: 'list', data: [{ id: 'm1' }, { id: 'm2' }] });
    const check = await checkModelConnection(
      { baseUrl: 'http://localhost:11434/v1/', apiKey: 'sk-test' },
      { fetch: fetchMock, now },
    );
    expect(check).toEqual({ ok: true, at: NOW.toISOString(), models: ['m1', 'm2'] });
    const [url, init] = vi.mocked(fetchMock).mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:11434/v1/models');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('sends no authorization header without a key', async () => {
    const fetchMock = respond(200, { data: [] });
    await checkModelConnection({ baseUrl: 'http://x/v1', apiKey: null }, { fetch: fetchMock, now });
    const init = vi.mocked(fetchMock).mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty('authorization');
  });

  it('tells a wrong key from other HTTP errors', async () => {
    const target = { baseUrl: 'https://llm.example.com/v1', apiKey: 'bad' };
    for (const status of [401, 403]) {
      const check = await checkModelConnection(target, { fetch: respond(status, {}), now });
      expect(check).toEqual({
        ok: false,
        at: NOW.toISOString(),
        error: { kind: 'unauthorized', status },
      });
    }
    const missing = await checkModelConnection(target, { fetch: respond(404, 'nope'), now });
    expect(missing.ok === false && missing.error).toEqual({ kind: 'http', status: 404 });
  });

  it('reports a response that is not an OpenAI model list', async () => {
    const html = await checkModelConnection(
      { baseUrl: 'http://x/v1', apiKey: null },
      { fetch: respond(200, '<!doctype html><title>Router</title>'), now },
    );
    expect(html.ok === false && html.error).toEqual({ kind: 'invalid-response' });
    const other = await checkModelConnection(
      { baseUrl: 'http://x/v1', apiKey: null },
      { fetch: respond(200, { models: [] }), now },
    );
    expect(other.ok === false && other.error).toEqual({ kind: 'invalid-response' });
  });

  it('reports an unreachable server with the system code', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const check = await checkModelConnection(
      { baseUrl: 'http://localhost:11434/v1', apiKey: null },
      { fetch: fetchMock, now },
    );
    expect(check.ok === false && check.error).toEqual({
      kind: 'unreachable',
      detail: 'ECONNREFUSED',
    });
  });

  it('gives up after the timeout, even if fetch ignores the abort signal', async () => {
    const fetchMock = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const check = await checkModelConnection(
      { baseUrl: 'http://10.0.0.9/v1', apiKey: null },
      { fetch: fetchMock, now, timeoutMs: 10 },
    );
    expect(check.ok === false && check.error).toEqual({ kind: 'timeout' });
  });

  it('counts an aborted request as a timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    const check = await checkModelConnection(
      { baseUrl: 'http://10.0.0.9/v1', apiKey: null },
      { fetch: fetchMock, now, timeoutMs: 10 },
    );
    expect(check.ok === false && check.error).toEqual({ kind: 'timeout' });
  });
});
