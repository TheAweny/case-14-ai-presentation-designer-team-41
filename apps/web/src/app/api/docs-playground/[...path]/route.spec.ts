import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken } from '@/lib/session-token';
import { POST } from './route';

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';

const SECRET = 'docs-console-proxy-secret';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function request(token?: string, origin = 'http://localhost:3002') {
  return new NextRequest('http://localhost:3000/api/docs-playground/generation/run-1/cancel', {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ reason: 'stop' }),
  });
}

describe('docs console proxy', () => {
  it('forwards a signed session and does not take the service token from the browser', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    vi.stubEnv('AUTH_SECRET', SECRET);
    const token = await signSessionToken(
      'user-1:session:server-session',
      Date.now() + 60_000,
      SECRET,
    );
    vi.mocked(apiFetch).mockResolvedValue(Response.json({ ok: true }));
    const response = await POST(request(token), {
      params: Promise.resolve({ path: ['generation', 'run-1', 'cancel'] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3002');
    expect(apiFetch).toHaveBeenCalledWith(
      '/generation/run-1/cancel',
      expect.objectContaining({ method: 'POST' }),
      { userId: 'user-1', sessionToken: 'server-session' },
    );
    const init = vi.mocked(apiFetch).mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get('x-lct-service-token')).toBeNull();
    expect(headers.get('authorization')).toBeNull();
  });

  it('refuses a missing session, a climb, and a disabled console', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    expect((await POST(request(), { params: Promise.resolve({ path: ['health'] }) })).status).toBe(
      401,
    );
    const token = await signSessionToken('user-1:session:server-session', Date.now() + 60_000, SECRET);
    vi.stubEnv('AUTH_SECRET', SECRET);
    expect(
      (await POST(request(token), { params: Promise.resolve({ path: ['..', 'health'] }) })).status,
    ).toBe(404);
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    expect((await POST(request(token), { params: Promise.resolve({ path: ['health'] }) })).status).toBe(
      404,
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
