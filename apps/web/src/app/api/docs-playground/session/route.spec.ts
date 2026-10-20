import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signSessionToken, verifySessionToken } from '@/lib/session-token';
import { DELETE, GET, OPTIONS, POST } from './route';

vi.mock('@/mocks/auth-source', () => ({
  authSource: { verifyPassword: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '@/lib/api';
import { authSource } from '@/mocks/auth-source';

const SECRET = 'docs-console-test-secret';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function call(
  method: string,
  body?: unknown,
  headers: Record<string, string> = { origin: 'http://localhost:3002' },
) {
  return new NextRequest('http://localhost:3000/api/docs-playground/session', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('docs console session', () => {
  it('answers preflight for the portal and refuses a foreign origin', async () => {
    expect((await OPTIONS(call('OPTIONS'))).status).toBe(204);
    const foreign = await OPTIONS(call('OPTIONS', undefined, { origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('stays off until API docs are enabled', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    const response = await POST(call('POST', { email: 'a@b.co', password: 'secret' }));
    expect(response.status).toBe(404);
    expect(authSource.verifyPassword).not.toHaveBeenCalled();
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3002');
  });

  it('signs a bearer for a valid password and hides the server session', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    vi.stubEnv('AUTH_SECRET', SECRET);
    vi.mocked(authSource.verifyPassword).mockResolvedValue({
      userId: 'user-1',
      email: 'a@b.co',
      name: 'Анна',
      role: 'user',
      sessionToken: 'server-session',
    });
    const response = await POST(call('POST', { email: 'a@b.co', password: 'correct-horse' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      account: { name: string; email: string; role: string };
      sessionToken?: string;
    };
    expect(body.account).toEqual({ name: 'Анна', email: 'a@b.co', role: 'user' });
    expect(body.sessionToken).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('server-session');
    expect(await verifySessionToken(body.token, SECRET)).toBe('user-1:session:server-session');
  });

  it('does not say whether the mail exists', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    vi.mocked(authSource.verifyPassword).mockResolvedValue(null);
    const response = await POST(call('POST', { email: 'missing@b.co', password: 'nope' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Неверная почта или пароль.' });
  });

  it('reads the live account and revokes it on sign-out', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    vi.stubEnv('AUTH_SECRET', SECRET);
    const token = await signSessionToken(
      'user-1:session:server-session',
      Date.now() + 60_000,
      SECRET,
    );
    vi.mocked(apiFetch).mockResolvedValueOnce(
      Response.json({
        account: { id: 'user-1', email: 'a@b.co', name: 'Анна', role: 'admin', disabled: false },
      }),
    );
    const current = await GET(
      call('GET', undefined, { origin: 'http://localhost:3002', authorization: `Bearer ${token}` }),
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      account: { name: 'Анна', email: 'a@b.co', role: 'admin' },
    });

    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gone = await DELETE(
      call('DELETE', undefined, {
        origin: 'http://localhost:3002',
        authorization: `Bearer ${token}`,
      }),
    );
    expect(gone.status).toBe(204);
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/auth/logout',
      { method: 'POST' },
      { userId: null, sessionToken: 'server-session' },
    );
  });
});
