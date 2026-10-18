import { describe, expect, it, vi } from 'vitest';
import { CompatibleRequests } from './compatibility.js';

const endpoint = 'https://provider.test/v1/chat/completions';
const base = {
  model: 'chosen',
  seed: 42,
  max_tokens: 32,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'result', strict: true, schema: { type: 'object' } },
  },
};
const refused = (param: string) =>
  Response.json({ error: { param, message: `Unsupported parameter: ${param}` } }, { status: 400 });
const call = (fetchImpl: typeof fetch) => new CompatibleRequests(fetchImpl);

describe('CompatibleRequests', () => {
  it('respects the caller retry budget during format negotiation', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => refused('response_format'));
    const reserve = vi.fn(() => false);
    expect((await call(fetchImpl).post(endpoint, {}, base, reserve)).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it.each(['token_quota_exhausted', 'insufficient_quota'])(
    'does not negotiate a format when the structured reason is exhausted quota (%s)',
    async (code) => {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
        Response.json(
          {
            error: { code, param: 'response_format', message: 'Unsupported format; PRIVATE_KEY' },
          },
          { status: 400 },
        ),
      );
      const result = await call(fetchImpl).post(endpoint, {}, base);
      expect(result.status).toBe(400);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('falls back from a rejected schema without changing model or schema in messages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('text.format.schema'))
      .mockResolvedValue(Response.json({}));
    await call(fetchImpl).post(
      endpoint,
      {},
      { ...base, messages: [{ role: 'system', content: 'schema instructions' }] },
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({
      model: 'chosen',
      response_format: { type: 'json_object' },
      messages: [{ content: 'schema instructions' }],
    });
  });
  it('falls back to plain output only after JSON mode is explicitly refused', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('response_format'))
      .mockResolvedValueOnce(refused('response_format'))
      .mockResolvedValue(Response.json({}));
    await call(fetchImpl).post(endpoint, {}, base);
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)).response_format).toBeUndefined();
  });
  it('remembers format refusal within one connection adapter', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('response_format'))
      .mockImplementation(async () => Response.json({}));
    const adapter = call(fetchImpl);
    await adapter.post(endpoint, {}, base);
    await adapter.post(endpoint, {}, base);
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)).response_format.type).toBe(
      'json_object',
    );
  });
  it('removes only the optional field explicitly refused', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('seed'))
      .mockResolvedValue(Response.json({}));
    await call(fetchImpl).post(endpoint, {}, base);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      model: 'chosen',
      max_tokens: 32,
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).seed).toBeUndefined();
  });
  it('renames an explicitly unsupported token limit without losing its value', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('max_tokens'))
      .mockResolvedValue(Response.json({}));
    await call(fetchImpl).post(endpoint, {}, base);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).max_completion_tokens).toBe(32);
  });
  it.each([401, 429, 500])(
    'never negotiates authentication, load or server failures (%s)',
    async (status) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(refused('seed'));
      fetchImpl.mockResolvedValueOnce(Response.json({ error: { param: 'seed' } }, { status }));
      expect((await call(fetchImpl).post(endpoint, {}, base)).status).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
  it('does not drop an explicitly requested thinking setting', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(refused('reasoning_effort'));
    expect(
      (await call(fetchImpl).post(endpoint, {}, { ...base, reasoning_effort: 'high' })).status,
    ).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not hide unrelated bad requests', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: { message: 'Invalid tool arguments' } }, { status: 400 }),
      );
    expect((await call(fetchImpl).post(endpoint, {}, base)).status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('negotiation boundaries', () => {
  it('uses nonstreaming only after explicit refusal and preserves tools', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('stream'))
      .mockResolvedValue(Response.json({}));
    await call(fetchImpl).post(
      endpoint,
      {},
      { model: 'chosen', stream: true, tools: [{ type: 'function' }] },
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toMatchObject({
      stream: false,
      tools: [{ type: 'function' }],
      model: 'chosen',
    });
  });
  it('keeps separate model adapters isolated', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(refused('response_format'))
      .mockImplementation(async () => Response.json({}));
    await call(fetchImpl).post(endpoint, {}, base);
    await call(fetchImpl).post(endpoint, {}, base);
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)).response_format.type).toBe(
      'json_schema',
    );
  });
  it('stops negotiation immediately when cancelled', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return refused('seed');
    });
    await expect(
      call(fetchImpl).post(endpoint, { signal: controller.signal }, base),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
