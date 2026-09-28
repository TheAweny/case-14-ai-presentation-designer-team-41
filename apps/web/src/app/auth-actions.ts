'use server';

import { redirect } from 'next/navigation';
import { LOGIN_PATH, NEXT_PARAM, safeNextPath } from '@/lib/auth';
import { authSource } from '@/mocks/auth-source';
import { endSession, startSession } from './auth-session';

/**
 * Итог попытки входа для формы: что не вышло и какую почту оставить в поле. Ошибку отдаём
 * значением — в сборке для продакшена Next прячет текст исключений.
 */
export interface SignInState {
  readonly error: 'invalid' | 'empty' | null;
  readonly email: string;
}

/** Вход по почте и паролю. Удалось — ведёт туда, куда человек шёл до входа. */
export async function signInAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = form.get('email');
  const password = form.get('password');
  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'invalid', email: '' };
  }
  if (email.trim() === '' || password === '') return { error: 'empty', email };

  const account = await authSource.verifyPassword(email, password);
  if (!account) return { error: 'invalid', email };

  await startSession(account);
  const next = form.get(NEXT_PARAM);
  redirect(safeNextPath(typeof next === 'string' ? next : null));
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect(LOGIN_PATH);
}
