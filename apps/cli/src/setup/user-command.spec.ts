import * as p from './ui.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvFile } from './env-file.js';
import { userCommand, usersMenu } from './user-command.js';

vi.mock('./ui.js', () => ({
  text: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  isCancel: (value: unknown) => typeof value === 'symbol',
  cancel: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('./env-file.js', () => ({ EnvFile: { open: vi.fn() } }));
vi.mock('./stack.js', () => ({ repoRoot: () => '/fake-repository' }));

const admin = {
  id: 'admin-id',
  email: 'admin@example.com',
  name: 'Администратор',
  role: 'admin',
  disabled: false,
  createdAt: '2026-10-20',
};
const user = {
  ...admin,
  id: 'user-id',
  email: 'user@example.com',
  name: 'Пользователь',
  role: 'user',
};
const session = { token: 'temporary-session', expiresAt: '2026-11-20T00:00:00.000Z' };
const auth = { 'login-email': admin.email, 'login-password': 'current-admin-password' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const empty = () => new Response(null, { status: 204 });
const verified = () => json({ account: admin, session });
const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function terminal(enabled: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value: enabled, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: enabled, configurable: true });
}

function fakeFetch(responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected HTTP request');
    return next;
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [
    'LCT_ADMIN_EMAIL',
    'LCT_ADMIN_PASSWORD',
    'ADMIN_PASSWORD',
    'ADMIN_EMAIL',
    'API_SERVICE_TOKEN',
    'API_HOST_PORT',
  ])
    vi.stubEnv(key, undefined);
  terminal(false);
  const values: Record<string, string> = {
    API_SERVICE_TOKEN: 'service-secret',
    API_HOST_PORT: '3107',
    ADMIN_EMAIL: admin.email,
    ADMIN_PASSWORD: 'stale-password',
    LCT_ADMIN_PASSWORD: 'file-password-must-not-be-used',
  };
  vi.mocked(EnvFile.open).mockReturnValue({ get: (key: string) => values[key] } as EnvFile);
  vi.mocked(p.text).mockRejectedValue(new Error('Unexpected text prompt'));
  vi.mocked(p.password).mockRejectedValue(new Error('Unexpected password prompt'));
  vi.mocked(p.select).mockRejectedValue(new Error('Unexpected select prompt'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  if (stdoutDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
});

describe('userCommand', () => {
  it('lists real API accounts using current credentials and the configured local port', async () => {
    const fetcher = fakeFetch([verified(), json([user]), empty()]);
    expect(await userCommand(['list'], auth)).toBe(0);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:3107/auth/verify');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      email: admin.email,
      password: auth['login-password'],
    });
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining(user.email));
    expect(p.text).not.toHaveBeenCalled();
    expect(p.password).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
  });

  it('creates an account with API-valid punctuation and normalizes email', async () => {
    const fetcher = fakeFetch([verified(), json(user, 201), empty()]);
    expect(
      await userCommand(['add'], {
        ...auth,
        email: ' User@Example.COM ',
        name: ' Анна; Иванова ',
        password: 'long : password;',
        role: 'admin',
      }),
    ).toBe(0);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      email: user.email,
      name: 'Анна; Иванова',
      password: 'long : password;',
      role: 'admin',
    });
  });

  it('defaults new accounts to user and supports a positional email', async () => {
    const fetcher = fakeFetch([verified(), json(user, 201), empty()]);
    expect(
      await userCommand(['add', user.email], { ...auth, name: 'Иван', password: 'password123' }),
    ).toBe(0);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).role).toBe('user');
  });

  it.each([
    ['role', { role: 'admin' }, { role: 'admin' }],
    ['disable', {}, { disabled: true }],
    ['enable', {}, { disabled: false }],
    ['password', { password: 'new user password' }, { password: 'new user password' }],
  ] as const)('applies %s to an account selected by email', async (action, flags, patch) => {
    const fetcher = fakeFetch([verified(), json([user]), json({ ...user, ...patch }), empty()]);
    expect(await userCommand([action, 'USER@EXAMPLE.COM'], { ...auth, ...flags })).toBe(0);
    expect(fetcher.mock.calls[2]?.[0]).toContain(`/users/${user.id}`);
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual(patch);
  });

  it('revokes sessions by id without deleting the account', async () => {
    const fetcher = fakeFetch([verified(), json([user]), empty(), empty()]);
    expect(await userCommand(['revoke-sessions'], { ...auth, id: user.id })).toBe(0);
    expect(fetcher.mock.calls[2]?.[0]).toContain(`/users/${user.id}/revoke-sessions`);
    expect(fetcher.mock.calls.every((call) => call[1]?.method !== 'DELETE')).toBe(true);
  });

  it.each(['delete', 'admin', 'unknown'])(
    'leaves unsupported/recovery command %s to the caller',
    async (action) => {
      const fetcher = fakeFetch([]);
      expect(await userCommand([action], auth)).toBe(2);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    [['role', user.id], { role: 'owner' }],
    [['password', user.id], { password: 'short' }],
    [['add'], { email: 'bad-email', name: 'Иван', password: 'password123' }],
    [['add'], { email: user.email, name: ' ', password: 'password123' }],
  ] as const)('rejects invalid input before authentication: %j', async (args, flags) => {
    const fetcher = fakeFetch([]);
    expect(await userCommand(args, { ...auth, ...flags })).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails promptly without TTY and never treats .env passwords as current credentials', async () => {
    const fetcher = fakeFetch([]);
    vi.stubEnv('ADMIN_PASSWORD', 'also-stale');
    expect(await userCommand(['list'], { 'login-email': admin.email })).toBe(1);
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining('--login-password'));
    expect(p.password).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires missing operation input without opening nonTTY prompts', async () => {
    const fetcher = fakeFetch([]);
    expect(await userCommand(['password', user.id], auth)).toBe(1);
    expect(p.password).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts optional credentials from the shell and shell connection settings', async () => {
    vi.stubEnv('LCT_ADMIN_EMAIL', admin.email);
    vi.stubEnv('LCT_ADMIN_PASSWORD', 'shell-current-password');
    vi.stubEnv('API_HOST_PORT', '4100');
    vi.stubEnv('API_SERVICE_TOKEN', 'shell-service-token');
    const fetcher = fakeFetch([verified(), json([]), empty()]);
    expect(await userCommand([], {})).toBe(0);
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://localhost:4100/auth/verify');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-lct-service-token': 'shell-service-token',
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).password).toBe(
      'shell-current-password',
    );
  });

  it('prompts for current administrator credentials interactively', async () => {
    terminal(true);
    vi.mocked(p.text).mockResolvedValueOnce(admin.email);
    vi.mocked(p.password).mockResolvedValueOnce('current-from-prompt');
    const fetcher = fakeFetch([verified(), json([]), empty()]);
    expect(await userCommand(['list'], {})).toBe(0);
    expect(p.text).toHaveBeenCalledWith(expect.objectContaining({ defaultValue: admin.email }));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).password).toBe(
      'current-from-prompt',
    );
  });

  it.each(['email', 'password', 'role', 'new-password'])(
    'handles cancellation at the %s prompt',
    async (prompt) => {
      terminal(true);
      const fetcher = fakeFetch([]);
      vi.mocked(p.text).mockResolvedValueOnce(Symbol('cancel'));
      vi.mocked(p.password).mockResolvedValueOnce(Symbol('cancel'));
      vi.mocked(p.select).mockResolvedValueOnce(Symbol('cancel'));
      const args =
        prompt === 'role'
          ? ['role', user.id]
          : prompt === 'new-password'
            ? ['password', user.id]
            : ['list'];
      expect(
        await userCommand(
          args,
          prompt === 'email' ? {} : prompt === 'password' ? { 'login-email': admin.email } : auth,
        ),
      ).toBe(130);
      expect(p.cancel).toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('reports server errors and logs out without printing credentials or session tokens', async () => {
    const fetcher = fakeFetch([
      verified(),
      json({ message: 'An account with this email already exists.' }, 409),
      empty(),
    ]);
    expect(
      await userCommand(['add'], {
        ...auth,
        email: user.email,
        name: 'Иван',
        password: 'new-account-secret',
      }),
    ).toBe(1);
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining('уже существует'));
    const output = JSON.stringify([
      vi.mocked(p.log.info).mock.calls,
      vi.mocked(p.log.error).mock.calls,
      vi.mocked(p.log.success).mock.calls,
    ]);
    for (const secret of [
      'service-secret',
      session.token,
      auth['login-password'],
      'new-account-secret',
      'stale-password',
    ])
      expect(output).not.toContain(secret);
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
  });

  it('rejects a normal user before any account API call and logs out', async () => {
    const fetcher = fakeFetch([json({ account: user, session }), empty()]);
    expect(await userCommand(['list'], auth)).toBe(1);
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining('ролью admin'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain('/auth/logout');
  });
});

describe('usersMenu', () => {
  function interactive(responses: Response[]) {
    terminal(true);
    vi.mocked(p.text).mockResolvedValue(admin.email);
    vi.mocked(p.password).mockResolvedValue('current-from-prompt');
    return fakeFetch(responses);
  }

  it('lists accounts and returns through Back using a single transient session', async () => {
    const fetcher = interactive([verified(), json([user]), empty()]);
    vi.mocked(p.select).mockResolvedValueOnce('list').mockResolvedValueOnce('back');
    await usersMenu();
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining(user.email));
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:3107/auth/verify',
      'http://localhost:3107/users',
      'http://localhost:3107/auth/logout',
    ]);
  });

  it('creates an account from prompts and chooses its role', async () => {
    const fetcher = interactive([verified(), json(user, 201), empty()]);
    vi.mocked(p.text)
      .mockReset()
      .mockResolvedValueOnce(admin.email)
      .mockResolvedValueOnce(user.email)
      .mockResolvedValueOnce('Иван');
    vi.mocked(p.password)
      .mockReset()
      .mockResolvedValueOnce('current-password')
      .mockResolvedValueOnce('new-user-password');
    vi.mocked(p.select)
      .mockResolvedValueOnce('create')
      .mockResolvedValueOnce('admin')
      .mockResolvedValueOnce('back');
    await usersMenu();
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
      email: user.email,
      name: 'Иван',
      role: 'admin',
      password: 'new-user-password',
    });
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
  });

  it.each([
    ['role', { role: 'admin' }],
    ['disable', { disabled: true }],
    ['enable', { disabled: false }],
    ['password', { password: 'current-from-prompt' }],
    ['revoke', undefined],
  ] as const)('selects an account and performs %s', async (operation, patch) => {
    const fetcher = interactive([
      verified(),
      json([user]),
      operation === 'revoke' ? empty() : json(user),
      empty(),
    ]);
    vi.mocked(p.select)
      .mockResolvedValueOnce('select')
      .mockResolvedValueOnce(user.id)
      .mockResolvedValueOnce(operation);
    if (operation === 'role') vi.mocked(p.select).mockResolvedValueOnce('admin');
    vi.mocked(p.select).mockResolvedValueOnce('back');
    await usersMenu();
    expect(fetcher.mock.calls[2]?.[0]).toContain(
      `/users/${user.id}${operation === 'revoke' ? '/revoke-sessions' : ''}`,
    );
    if (patch) expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual(patch);
    expect(p.log.success).toHaveBeenCalled();
  });

  it('logs out when a prompt is cancelled after login', async () => {
    const fetcher = interactive([verified(), json([user]), empty()]);
    vi.mocked(p.select)
      .mockResolvedValueOnce('select')
      .mockResolvedValueOnce(user.id)
      .mockResolvedValueOnce('password');
    vi.mocked(p.password)
      .mockReset()
      .mockResolvedValueOnce('current-password')
      .mockResolvedValueOnce(Symbol('cancel'));
    await usersMenu();
    expect(p.cancel).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('/auth/logout');
  });

  it('does not prompt for a menu without a TTY', async () => {
    const fetcher = fakeFetch([]);
    await usersMenu();
    expect(p.select).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(p.log.error).toHaveBeenCalled();
  });
});
