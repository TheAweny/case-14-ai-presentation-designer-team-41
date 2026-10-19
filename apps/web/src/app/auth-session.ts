import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOGIN_PATH, SESSION_COOKIE, authSecret, type Account } from '@/lib/auth';
import { SESSION_TTL_MS, signSessionToken, verifySessionToken } from '@/lib/session-token';
import { authSource } from '@/mocks/auth-source';
import { apiFetch, setActingUserResolver, setSessionResolver } from '@/lib/api';

/**
 * Сессия на сервере. Proxy проверяет только подпись cookie и пускает дальше; кто именно пришёл
 * и есть ли он ещё, решает `currentAccount` — его зовут макеты и каждое серверное действие:
 * действие — отдельная точка входа, и одной проверки в proxy ему мало.
 */

/** Id из подписанной cookie этого запроса; есть ли ещё такой аккаунт, проверит API. */
async function sessionUserId(): Promise<string | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const identity = await verifySessionToken(token, authSecret());
    return identity?.split(':session:')[0] ?? null;
  } catch {
    // Вне запроса cookie нет — и аккаунта тоже.
    return null;
  }
}

// Запросы серверного кода к API идут от вошедшего аккаунта: API отдаёт только его данные.
setActingUserResolver(sessionUserId);
setSessionResolver(async () => {
  try {
    const identity = await verifySessionToken(
      (await cookies()).get(SESSION_COOKIE)?.value,
      authSecret(),
    );
    return identity?.split(':session:')[1] ?? null;
  } catch {
    return null;
  }
});

/** Аккаунт этого запроса или null. Один раз на запрос, сколько бы компонентов ни спросили. */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const identity = await verifySessionToken(token, authSecret());
  // Legacy HMAC-only cookies have no durable session and require signing in again.
  if (!identity?.includes(':session:')) return null;
  return authSource.getAccount(identity.split(':session:')[0] ?? '');
});

/** Аккаунт этого запроса; гостя уводит на вход. */
export async function requireAccount(): Promise<Account> {
  const account = await currentAccount();
  if (!account) redirect(LOGIN_PATH);
  return account;
}

export async function startSession(account: Account): Promise<void> {
  if (!account.sessionToken) throw new Error('The API did not issue a revocable session.');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  (await cookies()).set(
    SESSION_COOKIE,
    await signSessionToken(
      `${account.userId}:session:${account.sessionToken}`,
      expiresAt,
      authSecret(),
    ),
    {
      httpOnly: true,
      sameSite: 'lax',
      // Только по https: продукт могут открыть и по http на адресе в сети, и тогда браузер
      // молча выбросил бы secure-cookie — вход бы «не срабатывал».
      secure:
        process.env.SESSION_COOKIE_SECURE === 'true' ||
        (process.env.NODE_ENV === 'production' && process.env.SESSION_COOKIE_SECURE !== 'false') ||
        (await headers()).get('origin')?.startsWith('https://') === true,
      path: '/',
      expires: new Date(expiresAt),
    },
  );
}

export async function endSession(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }, { userId: null });
  (await cookies()).delete(SESSION_COOKIE);
}
