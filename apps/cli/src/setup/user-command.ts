import { join } from 'node:path';
import * as p from './ui.js';
import {
  AccountClient,
  AccountClientError,
  type Account,
  type AccountInput,
  type AccountRole,
  type Credentials,
} from './account-client.js';
import { EnvFile } from './env-file.js';
import { repoRoot } from './stack.js';
import { normalizeEmail } from './users.js';

type Flags = Readonly<Record<string, string>>;
type Action = 'list' | 'add' | 'role' | 'disable' | 'enable' | 'password' | 'revoke-sessions';
const actions: readonly string[] = [
  'list',
  'add',
  'role',
  'disable',
  'enable',
  'password',
  'revoke-sessions',
];
class Cancelled extends Error {}

function requireTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new AccountClientError(
      'Без терминала укажите все параметры, включая --login-email и --login-password ' +
        '(или LCT_ADMIN_EMAIL и LCT_ADMIN_PASSWORD в окружении shell).',
    );
}

async function ask<T>(prompt: () => Promise<T | symbol>): Promise<T> {
  requireTerminal();
  const result = await prompt();
  if (p.isCancel(result)) throw new Cancelled();
  return result as T;
}

function emailProblem(value: string): string | undefined {
  if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return 'Нужна почта вида name@example.com, не длиннее 320 символов.';
  return undefined;
}

function passwordProblem(value: string): string | undefined {
  if (value.length < 8 || value.length > 200)
    return 'Пароль должен содержать от 8 до 200 символов.';
  return undefined;
}

function nameProblem(value: string): string | undefined {
  if (!value.trim() || value.trim().length > 120)
    return 'Имя должно содержать от 1 до 120 символов.';
  return undefined;
}

function checked(value: string, problem: (value: string) => string | undefined): string {
  const error = problem(value);
  if (error) throw new AccountClientError(error);
  return value;
}

function role(value: string): AccountRole {
  if (value !== 'user' && value !== 'admin')
    throw new AccountClientError('Укажите --role user или --role admin.');
  return value;
}

async function chooseRole(): Promise<AccountRole> {
  return ask(() =>
    p.select({
      message: 'Роль аккаунта',
      options: [
        { value: 'user' as const, label: 'Пользователь' },
        { value: 'admin' as const, label: 'Администратор' },
      ],
    }),
  );
}

async function newPassword(value?: string): Promise<string> {
  return checked(
    value ??
      (await ask(() =>
        p.password({
          message: 'Новый пароль аккаунта',
          validate: (input) => passwordProblem(input ?? ''),
        }),
      )),
    passwordProblem,
  );
}

async function accountInput(flags: Flags, target?: string): Promise<AccountInput> {
  const email = checked(
    normalizeEmail(
      flags.email ??
        target ??
        (await ask(() =>
          p.text({
            message: 'Почта нового аккаунта',
            validate: (input) => emailProblem(normalizeEmail(input ?? '')),
          }),
        )),
    ),
    emailProblem,
  );
  const name = checked(
    flags.name ??
      (await ask(() =>
        p.text({
          message: 'Имя аккаунта',
          validate: (input) => nameProblem(input ?? ''),
        }),
      )),
    nameProblem,
  ).trim();
  return {
    email,
    name,
    password: await newPassword(flags.password),
    role: role(flags.role ?? 'user'),
  };
}

function configuration(): { client: AccountClient; defaultEmail: string | undefined } {
  // Do not load .env into process.env: LCT_ADMIN_PASSWORD is accepted from the shell only.
  const env = EnvFile.open(join(repoRoot(), '.env'));
  return {
    client: new AccountClient({
      serviceToken: process.env.API_SERVICE_TOKEN ?? env.get('API_SERVICE_TOKEN') ?? '',
      port: process.env.API_HOST_PORT ?? env.get('API_HOST_PORT') ?? '3001',
    }),
    defaultEmail: process.env.ADMIN_EMAIL ?? env.get('ADMIN_EMAIL'),
  };
}

async function credentials(flags: Flags, defaultEmail?: string): Promise<Credentials> {
  const suppliedEmail = flags['login-email'] ?? process.env.LCT_ADMIN_EMAIL;
  const email = checked(
    normalizeEmail(
      suppliedEmail ??
        (await ask(() =>
          p.text({
            message: 'Актуальная почта администратора',
            ...(defaultEmail ? { defaultValue: defaultEmail, placeholder: defaultEmail } : {}),
            validate: (input) => emailProblem(normalizeEmail(input || defaultEmail || '')),
          }),
        )),
    ),
    emailProblem,
  );
  const password =
    flags['login-password'] ??
    process.env.LCT_ADMIN_PASSWORD ??
    (await ask(() =>
      p.password({
        message: 'Актуальный пароль администратора',
        validate: (input) => (input ? undefined : 'Введите актуальный пароль.'),
      }),
    ));
  if (!password || password.length > 1024)
    throw new AccountClientError('Укажите актуальный пароль администратора (до 1024 символов).');
  return { email, password };
}

function display(accounts: readonly Account[]): void {
  if (!accounts.length) {
    p.log.info('Аккаунтов нет.');
    return;
  }
  // No raw objects: neither unexpected response fields nor avatar data reach the terminal.
  const text = accounts
    .map(
      (account) =>
        `${account.id}\t${account.email}\t${account.name}\t${account.role}\t${account.disabled ? 'отключён' : 'активен'}`,
    )
    .join('\n');
  p.log.info(text.replace(/[^\P{Cc}\t\n]/gu, ''));
}

function report(error: unknown): number {
  if (error instanceof Cancelled) {
    p.cancel('Управление аккаунтами отменено.');
    return 130;
  }
  p.log.error(
    error instanceof AccountClientError
      ? error.message
      : 'Не удалось выполнить операцию с аккаунтом.',
  );
  return 1;
}

/** Called with arguments after `lct user`; recovery `admin` stays with the caller. */
export async function userCommand(args: readonly string[], flags: Flags): Promise<number> {
  const [requested = 'list', positionalTarget] = args;
  if (
    !actions.includes(requested) ||
    args.length > 2 ||
    (requested === 'list' && args.length > 1)
  ) {
    p.log.error('Команды: list, add, role, disable, enable, password, revoke-sessions.');
    return 2;
  }
  try {
    const action = requested as Action;
    const input = action === 'add' ? await accountInput(flags, positionalTarget) : undefined;
    const selectedRole =
      action === 'role'
        ? flags.role === undefined
          ? await chooseRole()
          : role(flags.role)
        : undefined;
    const password = action === 'password' ? await newPassword(flags.password) : undefined;
    const target =
      action === 'list' || action === 'add'
        ? undefined
        : (positionalTarget ??
          flags.id ??
          flags.email ??
          (await ask(() =>
            p.text({
              message: 'Почта или id аккаунта',
              validate: (value) => (value?.trim() ? undefined : 'Укажите почту или id.'),
            }),
          )));
    if (target !== undefined && !target.trim())
      throw new AccountClientError('Укажите почту или id аккаунта.');
    const { client, defaultEmail } = configuration();
    const login = await credentials(flags, defaultEmail);
    await client.withAdminSession(login, async (api) => {
      if (action === 'list') {
        display(await api.list());
        return;
      }
      if (input) {
        await api.create(input);
        return;
      }
      const account = await api.resolve(target ?? '');
      if (action === 'revoke-sessions') {
        await api.revokeSessions(account.id);
        return;
      }
      const patch =
        action === 'role'
          ? { role: selectedRole }
          : action === 'password'
            ? { password }
            : { disabled: action === 'disable' };
      await api.update(account.id, patch);
    });
    if (action !== 'list') p.log.success('Операция с аккаунтом выполнена.');
    return 0;
  } catch (error) {
    return report(error);
  }
}

/** Owns one transient login for the menu visit; no credentials or sessions are persisted. */
export async function usersMenu(): Promise<void> {
  try {
    requireTerminal();
    const { client, defaultEmail } = configuration();
    const login = await credentials({}, defaultEmail);
    await client.withAdminSession(login, async (api) => {
      for (;;) {
        const action = await ask(() =>
          p.select({
            message: 'Пользователи',
            options: [
              { value: 'list', label: 'Список аккаунтов' },
              { value: 'create', label: 'Создать аккаунт' },
              { value: 'select', label: 'Выбрать аккаунт' },
              { value: 'back', label: 'Назад' },
            ],
          }),
        );
        if (action === 'back') return;
        if (action === 'list') {
          display(await api.list());
          continue;
        }
        if (action === 'create') {
          const input = await accountInput({});
          await api.create({ ...input, role: await chooseRole() });
        } else {
          const accounts = await api.list();
          if (!accounts.length) {
            display(accounts);
            continue;
          }
          const id = await ask(() =>
            p.select({
              message: 'Выберите аккаунт',
              options: [
                ...accounts.map((account) => ({
                  value: account.id,
                  label: `${account.email} — ${account.name}`,
                  hint: `${account.role}, ${account.disabled ? 'отключён' : 'активен'}`,
                })),
                { value: '', label: 'Назад' },
              ],
            }),
          );
          if (!id) continue;
          const operation = await ask(() =>
            p.select({
              message: 'Действие с аккаунтом',
              options: [
                { value: 'role', label: 'Сменить роль' },
                { value: 'disable', label: 'Заблокировать' },
                { value: 'enable', label: 'Разблокировать' },
                { value: 'password', label: 'Сбросить пароль' },
                { value: 'revoke', label: 'Отозвать все сессии' },
                { value: 'back', label: 'Назад' },
              ],
            }),
          );
          if (operation === 'back') continue;
          if (operation === 'revoke') await api.revokeSessions(id);
          else if (operation === 'role') await api.update(id, { role: await chooseRole() });
          else if (operation === 'password')
            await api.update(id, { password: await newPassword() });
          else await api.update(id, { disabled: operation === 'disable' });
        }
        p.log.success('Операция с аккаунтом выполнена.');
      }
    });
  } catch (error) {
    report(error);
  }
}
