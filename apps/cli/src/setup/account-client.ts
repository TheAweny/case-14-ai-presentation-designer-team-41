import { z } from 'zod';

// HTTP DTOs are local until the account API publishes shared contracts.
const accountSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string(),
  role: z.enum(['user', 'admin']),
  disabled: z.boolean(),
  createdAt: z.string(),
  avatar: z.string().nullable().optional(),
});
const sessionSchema = z.object({
  token: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/),
  expiresAt: z.string().datetime(),
});
const verifySchema = z.object({
  account: accountSchema.nullable(),
  session: sessionSchema.optional(),
});
const errorSchema = z.object({ message: z.union([z.string(), z.array(z.string())]) });

export type Account = z.infer<typeof accountSchema>;
export type AccountRole = Account['role'];
export interface Credentials {
  readonly email: string;
  readonly password: string;
}
export interface AccountInput extends Credentials {
  readonly name: string;
  readonly role: AccountRole;
}

/** Only these safe messages may be printed; fetch/Zod errors can contain secrets. */
export class AccountClientError extends Error {}

const serverMessages: Readonly<Record<string, string>> = {
  'An account with this email already exists.': 'Аккаунт с такой почтой уже существует.',
  'Account not found.': 'Аккаунт не найден.',
  'You cannot demote or switch off your own account.':
    'Нельзя понизить роль или отключить собственный аккаунт.',
  'The installation must keep at least one administrator.':
    'В установке должен остаться хотя бы один администратор.',
  'Only an administrator can do this.': 'Для операции нужны права администратора.',
  'Sign in first.': 'Нужно войти заново с актуальным паролем администратора.',
  'Сессия завершена. Войдите снова.': 'Сессия завершена. Войдите снова.',
  'Слишком много попыток входа. Повторите через 15 минут.':
    'Слишком много попыток входа. Повторите через 15 минут.',
  'Unknown role.': 'Допустимые роли: user, admin.',
  'Email is required.': 'Укажите почту аккаунта.',
  'Email must look like name@example.com.': 'Нужна почта вида name@example.com.',
  'Name is required.': 'Укажите имя аккаунта.',
  'Name must be at most 120 characters.': 'Имя должно быть не длиннее 120 символов.',
  'Password is required.': 'Укажите пароль аккаунта.',
  'Password must be at least 8 characters.': 'Пароль должен быть не короче 8 символов.',
  'Password must be at most 200 characters.': 'Пароль должен быть не длиннее 200 символов.',
};

function httpProblem(status: number, body: unknown): AccountClientError {
  const parsed = errorSchema.safeParse(body);
  const messages = parsed.success
    ? typeof parsed.data.message === 'string'
      ? [parsed.data.message]
      : parsed.data.message
    : [];
  const known = messages.map((message) => serverMessages[message]).filter(Boolean);
  const fallback: Readonly<Record<number, string>> = {
    400: 'API отклонил параметры операции.',
    401: 'Сессия завершена. Проверьте актуальные данные входа.',
    403: 'Доступ запрещён. Проверьте API_SERVICE_TOKEN и права администратора.',
    404: 'Аккаунт или маршрут API не найден.',
    409: 'Операция конфликтует с текущим состоянием аккаунта.',
    429: 'Слишком много попыток входа. Повторите позже.',
  };
  // Unknown response text is deliberately omitted: servers/proxies may echo credentials.
  return new AccountClientError(
    `API (HTTP ${status}): ${known.join(' ') || fallback[status] || 'Ошибка сервера.'}`,
  );
}

export interface AccountClientOptions {
  readonly serviceToken: string;
  readonly port?: string | number;
  readonly fetch?: typeof globalThis.fetch;
}

/** Local HTTP only. Sessions live in memory for the duration of withAdminSession. */
export class AccountClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private session: { token: string; userId?: string } | undefined;
  private active = false;
  private authenticated = false;

  constructor(private readonly options: AccountClientOptions) {
    const port = String(options.port ?? 3001);
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      throw new AccountClientError('API_HOST_PORT должен быть числом от 1 до 65535.');
    if (!options.serviceToken.trim() || /[\r\n]/.test(options.serviceToken))
      throw new AccountClientError('Не задан корректный API_SERVICE_TOKEN. Запустите настройку.');
    this.baseUrl = `http://127.0.0.1:${Number(port)}`;
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  private async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const headers: Record<string, string> = {
      'x-lct-service-token': this.options.serviceToken,
    };
    if (this.session) {
      headers['x-lct-session'] = this.session.token;
      if (this.session.userId) headers['x-lct-user'] = this.session.userId;
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new AccountClientError(
        `Нет ответа API на ${this.baseUrl}. Проверьте запуск API и API_HOST_PORT.`,
      );
    }
    if (response.status === 204) return undefined;
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (!response.ok) throw httpProblem(response.status, undefined);
      throw new AccountClientError('API вернул некорректный JSON.');
    }
    if (!response.ok) throw httpProblem(response.status, data);
    return data;
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) throw new AccountClientError('Ответ API не соответствует схеме аккаунта.');
    return result.data;
  }

  async withAdminSession<T>(
    credentials: Credentials,
    operation: (client: AccountClient) => Promise<T>,
  ): Promise<T> {
    if (this.active) throw new AccountClientError('Вход администратора уже выполняется.');
    this.active = true;
    let result: T;
    let logoutFailed = false;
    try {
      const data = await this.request('/auth/verify', 'POST', credentials);
      // Capture a usable token before validating the rest, so a malformed account is logged out too.
      const issued = z
        .object({ session: z.object({ token: sessionSchema.shape.token }) })
        .safeParse(data);
      if (issued.success) this.session = { token: issued.data.session.token };
      const answer = this.parse(verifySchema, data);
      if (!answer.account)
        throw new AccountClientError('Неверная почта или пароль, либо аккаунт отключён.');
      if (!answer.session)
        throw new AccountClientError('API не выдал сессию. Проверьте версию API.');
      this.session = { token: answer.session.token, userId: answer.account.id };
      if (answer.account.role !== 'admin' || answer.account.disabled)
        throw new AccountClientError('Нужен активный аккаунт с ролью admin.');
      this.authenticated = true;
      result = await operation(this);
    } finally {
      this.authenticated = false;
      try {
        if (this.session) {
          const data = await this.request('/auth/logout', 'POST');
          if (data !== undefined) logoutFailed = true;
        }
      } catch {
        logoutFailed = true;
      } finally {
        this.session = undefined;
        this.active = false;
      }
    }
    if (logoutFailed)
      throw new AccountClientError('Операция выполнена, но завершить временную сессию не удалось.');
    return result;
  }

  private requireSession(): void {
    if (!this.authenticated) throw new AccountClientError('Сначала войдите как администратор.');
  }

  async list(): Promise<Account[]> {
    this.requireSession();
    return this.parse(z.array(accountSchema), await this.request('/users'));
  }

  async resolve(target: string): Promise<Account> {
    const key = target.trim().toLowerCase();
    const account = (await this.list()).find(
      (item) => item.id.toLowerCase() === key || item.email.toLowerCase() === key,
    );
    if (!account) throw new AccountClientError('Аккаунт с указанной почтой или id не найден.');
    return account;
  }

  async create(input: AccountInput): Promise<Account> {
    this.requireSession();
    return this.parse(accountSchema, await this.request('/users', 'POST', input));
  }

  async update(
    id: string,
    patch: { role?: AccountRole; disabled?: boolean; password?: string },
  ): Promise<Account> {
    this.requireSession();
    return this.parse(
      accountSchema,
      await this.request(`/users/${encodeURIComponent(id)}`, 'PATCH', patch),
    );
  }

  async revokeSessions(id: string): Promise<void> {
    this.requireSession();
    const data = await this.request(`/users/${encodeURIComponent(id)}/revoke-sessions`, 'POST');
    if (data !== undefined)
      throw new AccountClientError('API вернул неожиданный ответ отзыва сессий.');
  }
}
