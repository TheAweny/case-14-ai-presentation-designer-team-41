import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOGIN_PATH, SESSION_COOKIE, authSecret, type Account } from '@/lib/auth';
import { SESSION_TTL_MS, signSessionToken, verifySessionToken } from '@/lib/session-token';
import { authSource } from '@/mocks/auth-source';

/**
 * Сессия на сервере. Proxy проверяет только подпись cookie и пускает дальше; кто именно пришёл
 * и есть ли он ещё, решает `currentAccount` — его зовут макеты и каждое серверное действие:
 * действие — отдельная точка входа, и одной проверки в proxy ему мало.
 */

/** Аккаунт этого запроса или null. Один раз на запрос, сколько бы компонентов ни спросили. */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await verifySessionToken(token, authSecret());
  return userId === null ? null : authSource.getAccount(userId);
});

/** Аккаунт этого запроса; гостя уводит на вход. */
export async function requireAccount(): Promise<Account> {
  const account = await currentAccount();
  if (!account) redirect(LOGIN_PATH);
  return account;
}

export async function startSession(account: Account): Promise<void> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  (await cookies()).set(
    SESSION_COOKIE,
    await signSessionToken(account.userId, expiresAt, authSecret()),
    {
      httpOnly: true,
      sameSite: 'lax',
      // Только по https: продукт могут открыть и по http на адресе в сети, и тогда браузер
      // молча выбросил бы secure-cookie — вход бы «не срабатывал».
      secure: (await headers()).get('x-forwarded-proto') === 'https',
      path: '/',
      expires: new Date(expiresAt),
    },
  );
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
