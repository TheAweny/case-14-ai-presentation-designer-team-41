import { describe, expect, it, vi } from 'vitest';
import { AccountClient } from './account-client.js';

const admin = {
  id: 'admin-id',
  email: 'admin@example.com',
  name: 'Администратор',
  role: 'admin',
  disabled: false,
  createdAt: '2026-10-20T00:00:00.000Z',
  avatar: null,
};
const session = { token: 'temporary-session', expiresAt: '2026-11-20T00:00:00.000Z' };
const login = { email: admin.email, password: 'current-password' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const empty = () => new Response(null, { status: 204 });

function fixture(responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected HTTP request');
    return next;
  });
  const client = new AccountClient({
    serviceToken: 'service-secret',
    port: '3141',
    fetch: fetcher,
  });
  return { client, fetcher };
}

describe('AccountClient', () => {
  it('verifies credentials, sends all account headers, and logs out its transient session', async () => {
    const { client, fetcher } = fixture([
      json({ account: admin, session }),
      json([admin]),
      empty(),
    ]);
    await expect(client.withAdminSession(login, (api) => api.list())).resolves.toEqual([admin]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:3141/auth/verify',
      'http://127.0.0.1:3141/users',
      'http://127.0.0.1:3141/auth/logout',
    ]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(login),
      redirect: 'error',
      headers: { 'x-lct-service-token': 'service-secret', 'content-type': 'application/json' },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('x-lct-session');
    for (const call of fetcher.mock.calls.slice(1)) {
      expect(call[1]?.headers).toEqual({
        'x-lct-service-token': 'service-secret',
        'x-lct-user': admin.id,
        'x-lct-session': session.token,
      });
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    await expect(client.list()).rejects.toThrow('Сначала войдите');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    { ...admin, role: 'user' },
    { ...admin, disabled: true },
  ])('rejects a nonadmin or disabled account and still logs out: %j', async (account) => {
    const { client, fetcher } = fixture([json({ account, session }), empty()]);
    const operation = vi.fn();
    await expect(client.withAdminSession(login, operation)).rejects.toThrow('ролью admin');
    expect(operation).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[1]?.[0]).toContain('/auth/logout');
  });

  it('reports incorrect credentials without attempting account operations', async () => {
    const { client, fetcher } = fixture([json({ account: null })]);
    await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'Неверная почта',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses an API that did not issue a session', async () => {
    const { client, fetcher } = fixture([json({ account: admin })]);
    await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'не выдал сессию',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { account: { ...admin, role: 'owner' }, session },
    { account: admin, session: { ...session, expiresAt: 'invalid' } },
  ])('cleans up an issued session even when verify has malformed fields: %j', async (answer) => {
    const { client, fetcher } = fixture([json(answer), empty()]);
    await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'не соответствует',
    );
    expect(fetcher.mock.calls[1]?.[0]).toContain('/auth/logout');
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-lct-session': session.token });
  });

  it('validates list and mutation responses and logs out on schema errors', async () => {
    const { client, fetcher } = fixture([
      json({ account: admin, session }),
      json([{ email: 'only' }]),
      empty(),
    ]);
    await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'не соответствует',
    );
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
    const other = fixture([
      json({ account: admin, session }),
      json({ ...admin, disabled: 'yes' }),
      empty(),
    ]);
    await expect(
      other.client.withAdminSession(login, (api) => api.update('id', { disabled: true })),
    ).rejects.toThrow('не соответствует');
  });

  it('resolves email without case sensitivity and resolves id', async () => {
    const { client } = fixture([
      json({ account: admin, session }),
      json([admin]),
      json([admin]),
      empty(),
    ]);
    await client.withAdminSession(login, async (api) => {
      expect(await api.resolve(' ADMIN@EXAMPLE.COM ')).toEqual(admin);
      expect(await api.resolve(admin.id)).toEqual(admin);
    });
  });

  it('does not send a mutation for an unknown account', async () => {
    const { client, fetcher } = fixture([json({ account: admin, session }), json([]), empty()]);
    await expect(client.withAdminSession(login, (api) => api.resolve('absent'))).rejects.toThrow(
      'не найден',
    );
    expect(fetcher.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET', 'POST']);
  });

  it('uses existing create, patch and revoke endpoints and encodes ids', async () => {
    const { client, fetcher } = fixture([
      json({ account: admin, session }),
      json(admin, 201),
      json(admin),
      empty(),
      empty(),
    ]);
    const input = { ...login, name: 'Иван', role: 'user' as const };
    await client.withAdminSession(login, async (api) => {
      await api.create(input);
      await api.update('id/with?path', { role: 'admin' });
      await api.revokeSessions('id/with?path');
    });
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(input));
    expect(fetcher.mock.calls[2]?.[0]).toContain('/users/id%2Fwith%3Fpath');
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe('PATCH');
    expect(fetcher.mock.calls[3]?.[0]).toContain('/users/id%2Fwith%3Fpath/revoke-sessions');
    expect(fetcher.mock.calls[3]?.[1]?.method).toBe('POST');
  });

  it.each([
    [403, 'Only an administrator can do this.', 'права администратора'],
    [409, 'An account with this email already exists.', 'уже существует'],
    [400, 'You cannot demote or switch off your own account.', 'собственный аккаунт'],
    [401, 'Сессия завершена. Войдите снова.', 'Сессия завершена'],
    [429, 'Слишком много попыток входа. Повторите через 15 минут.', 'через 15 минут'],
    [500, 'echo current-password service-secret temporary-session', 'Ошибка сервера'],
  ])('explains HTTP %i and logs out without echoing secrets', async (status, message, expected) => {
    const { client, fetcher } = fixture([
      json({ account: admin, session }),
      json({ message }, Number(status)),
      empty(),
    ]);
    const error = await client
      .withAdminSession(login, (api) => api.list())
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(String(expected));
    for (const secret of [login.password, 'service-secret', session.token])
      expect(String(error)).not.toContain(secret);
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
  });

  it('handles invalid JSON and non-JSON proxy errors safely', async () => {
    for (const status of [200, 502]) {
      const { client } = fixture([new Response('secret proxy HTML', { status })]);
      await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
        status === 200 ? 'некорректный JSON' : 'HTTP 502',
      );
    }
  });

  it('reports an unreachable local API without exposing the underlying fetch error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret network detail'));
    const client = new AccountClient({ serviceToken: 'secret', fetch: fetcher });
    await expect(client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'Нет ответа API',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports failed cleanup after success and preserves an original operation error', async () => {
    const success = fixture([
      json({ account: admin, session }),
      json([]),
      json({ message: 'failed' }, 500),
    ]);
    await expect(success.client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'завершить временную сессию',
    );
    await expect(success.client.list()).rejects.toThrow('Сначала войдите');
    const failure = fixture([
      json({ account: admin, session }),
      json({ message: 'failed' }, 409),
      json({}, 500),
    ]);
    await expect(failure.client.withAdminSession(login, (api) => api.list())).rejects.toThrow(
      'HTTP 409',
    );
  });

  it('starts each invocation without a previous session and rejects overlapping logins', async () => {
    const { client, fetcher } = fixture([
      json({ account: admin, session }),
      empty(),
      json({ account: admin, session }),
      empty(),
    ]);
    await client.withAdminSession(login, async () => {
      await expect(client.withAdminSession(login, async () => undefined)).rejects.toThrow(
        'уже выполняется',
      );
    });
    await client.withAdminSession(login, async () => undefined);
    expect(fetcher.mock.calls[2]?.[1]?.headers).not.toHaveProperty('x-lct-session');
  });

  it.each(['0', '65536', '3001/path', 'localhost:3001', ''])(
    'refuses an invalid local port: %s',
    (port) => {
      expect(() => new AccountClient({ serviceToken: 'token', port })).toThrow('API_HOST_PORT');
    },
  );

  it('requires the installation service token', () => {
    expect(() => new AccountClient({ serviceToken: '' })).toThrow('API_SERVICE_TOKEN');
  });
});
