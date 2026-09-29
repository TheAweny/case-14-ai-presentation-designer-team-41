import type { AccountRole } from './auth';

/**
 * Аккаунты установки, как их видит администратор в настройках. Правила те же, что у API
 * (`apps/api/src/accounts/account-rules.ts`): поле объясняет ошибку до отправки, а API всё равно
 * проверяет сам.
 *
 * Модуль без React и сети: правила и разбор ответа проверяют тесты.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_NAME_LENGTH = 120;

export interface ManagedUser {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
  /** Отключён: войти не может, его данные целы. */
  readonly disabled: boolean;
  /** Мс с эпохи. */
  readonly createdAt: number;
}

/** Что не так с полем: ключ словаря `settings.users.problems`, null — всё в порядке. */
export type UserFieldProblem = 'email' | 'passwordShort' | 'passwordLong' | 'name' | null;

export function emailProblem(email: string): UserFieldProblem {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'email';
}

export function passwordProblem(password: string): UserFieldProblem {
  if (password.length < MIN_PASSWORD_LENGTH) return 'passwordShort';
  if (password.length > MAX_PASSWORD_LENGTH) return 'passwordLong';
  return null;
}

export function nameProblem(name: string): UserFieldProblem {
  const value = name.trim();
  return value === '' || value.length > MAX_NAME_LENGTH ? 'name' : null;
}

/** Аккаунт из ответа API или null. */
export function managedUserOf(row: unknown): ManagedUser | null {
  if (typeof row !== 'object' || row === null) return null;
  const value = row as Record<string, unknown>;
  if (typeof value.id !== 'string' || typeof value.email !== 'string') return null;
  return {
    userId: value.id,
    email: value.email,
    name: typeof value.name === 'string' ? value.name : value.email,
    role: value.role === 'admin' ? 'admin' : 'user',
    disabled: value.disabled === true,
    createdAt: Date.parse(String(value.createdAt)) || 0,
  };
}

/** Надёжный пароль для нового аккаунта или сброса: администратор передаёт его человеку. */
export function generatePassword(random: (bytes: Uint8Array) => Uint8Array): string {
  // Без похожих друг на друга символов: пароль читают глазами и набирают вручную.
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = random(new Uint8Array(14));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
