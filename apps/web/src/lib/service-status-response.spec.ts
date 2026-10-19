import { afterEach, describe, expect, it, vi } from 'vitest';
import { serviceStatusResponse } from './service-status-response';
import { signSessionToken } from './session-token';

const secret = 'health-fixture-secret';
const user = 'health-owner';
const cookie = () =>
  signSessionToken(`${user}:session:${'a'.repeat(43)}`, Date.now() + 60000, secret);
function healthy(path: string) {
  return Response.json({
    service: path === '/health' ? 'api' : path === '/health/engine' ? 'engine' : 'postgresql',
    status: 'ok',
    version: '1',
    uptimeSeconds: 1,
  });
}
const authorized = async (path: string) =>
  path.startsWith('/auth/') ? Response.json({ account: { id: user } }) : healthy(path);
afterEach(() => vi.useRealTimers());
describe('service status with revocable sessions and outages', () => {
  it('passes only the account id, preserves healthy services, and does not cache', async () => {
    const fetch = vi.fn(async (path: string, _init: RequestInit, _userId: string) =>
      authorized(path),
    );
    const result = await serviceStatusResponse(await cookie(), secret, fetch);
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect((await result.json()).services).toEqual({ api: 'ok', engine: 'ok', database: 'ok' });
    expect(fetch.mock.calls).toHaveLength(4);
    for (const call of fetch.mock.calls) {
      expect(call[2]).toBe(user);
      expect(call[1].signal).toBeDefined();
    }
  });
  it.each(['missing', 'legacy', 'forged', 'expired'])(
    'refuses %s cookies before contacting a backend',
    async (kind) => {
      const value =
        kind === 'missing'
          ? undefined
          : await signSessionToken(
              kind === 'legacy' ? user : `${user}:session:${'a'.repeat(43)}`,
              Date.now() + (kind === 'expired' ? -1000 : 60000),
              kind === 'forged' ? 'other' : secret,
            );
      const fetch = vi.fn(authorized);
      expect((await serviceStatusResponse(value, secret, fetch)).status).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(['rejected', 'removed'])('returns 401 only on confirmed %s sessions', async (kind) => {
    const fetch = vi.fn(async (path: string) =>
      path.startsWith('/auth/')
        ? kind === 'removed'
          ? Response.json({ account: null })
          : new Response(null, { status: 401 })
        : healthy(path),
    );
    expect((await serviceStatusResponse(await cookie(), secret, fetch)).status).toBe(401);
    expect(fetch.mock.calls.every(([path]) => !path.startsWith('/health/'))).toBe(true);
  });
  it.each(['503', '403', 'throw', 'json', 'shape', 'foreign'])(
    'reports auth %s as degraded and does not query protected health endpoints',
    async (kind) => {
      const fetch = vi.fn(async (path: string) => {
        if (!path.startsWith('/auth/')) return healthy(path);
        if (kind === 'throw') throw new TypeError('Connection refused');
        if (kind === 'json') return new Response('{');
        if (kind === 'shape') return Response.json({});
        if (kind === 'foreign') return Response.json({ account: { id: 'foreign' } });
        return new Response(null, { status: Number(kind) });
      });
      const result = await serviceStatusResponse(await cookie(), secret, fetch);
      expect(result.status).toBe(200);
      expect((await result.json()).services).toEqual({
        api: 'degraded',
        engine: 'unknown',
        database: 'unknown',
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it('reports total API loss without hiding behind a failed auth lookup', async () => {
    const result = await serviceStatusResponse(await cookie(), secret, async () => {
      throw new TypeError('Connection refused');
    });
    expect(result.status).toBe(200);
    expect((await result.json()).services).toEqual({
      api: 'down',
      engine: 'unknown',
      database: 'unknown',
    });
  });
  it('bounds a hung auth lookup while probing public liveness independently', async () => {
    const value = await cookie();
    vi.useFakeTimers();
    const fetch = vi.fn(async (path: string, init: RequestInit) => {
      if (!path.startsWith('/auth/')) return healthy(path);
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('Timeout')), { once: true }),
      );
    });
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const pending = serviceStatusResponse(value, secret, fetch);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(2000);
      expect((await (await pending).json()).services).toEqual({
        api: 'degraded',
        engine: 'unknown',
        database: 'unknown',
      });
    } finally {
      timeout.mockRestore();
    }
  });
  it('keeps database failure distinct from session rejection and handles revoke during probes', async () => {
    const value = await cookie();
    const result = await serviceStatusResponse(value, secret, async (path) =>
      path === '/health/database' ? new Response(null, { status: 503 }) : authorized(path),
    );
    expect((await result.json()).services).toEqual({ api: 'ok', engine: 'ok', database: 'down' });
    const revoked = await serviceStatusResponse(value, secret, async (path) =>
      path === '/health/database' ? new Response(null, { status: 401 }) : authorized(path),
    );
    expect(revoked.status).toBe(401);
  });
});
