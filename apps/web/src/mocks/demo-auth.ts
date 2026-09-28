import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { normalizeEmail, type Account, type AuthSource, type SeedUser } from '../lib/auth';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;

interface StoredUser {
  readonly account: Account;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LENGTH);
}

/**
 * Демо-хранилище аккаунтов, пока API нет: пользователи из `AUTH_USERS`, в памяти сервера.
 * Пароли держим только хешами scrypt — открытый пароль живёт лишь в переменной окружения.
 *
 * Id пользователя — его почта: она постоянна между перезапусками, и выданные сессии не
 * слетают. Настоящие id выдаст API.
 */
export function createDemoAuth(seed: readonly SeedUser[]): AuthSource {
  const users = new Map<string, Promise<StoredUser>>();
  for (const user of seed) {
    const salt = randomBytes(16);
    users.set(
      user.email,
      hashPassword(user.password, salt).then((hash) => ({
        account: { userId: user.email, email: user.email, name: user.name },
        salt,
        hash,
      })),
    );
  }
  // Незнакомую почту проверяем тем же scrypt: по времени ответа не понять, есть ли такой аккаунт.
  const decoy = hashPassword(randomBytes(16).toString('hex'), randomBytes(16));

  return {
    async hasAccounts() {
      return users.size > 0;
    },

    async verifyPassword(email, password) {
      if (typeof email !== 'string' || typeof password !== 'string') return null;
      const stored = await users.get(normalizeEmail(email));
      if (!stored) {
        await hashPassword(password, randomBytes(16));
        await decoy;
        return null;
      }
      const hash = await hashPassword(password, stored.salt);
      return timingSafeEqual(hash, stored.hash) ? stored.account : null;
    },

    async getAccount(userId) {
      return (await users.get(userId))?.account ?? null;
    },
  };
}
