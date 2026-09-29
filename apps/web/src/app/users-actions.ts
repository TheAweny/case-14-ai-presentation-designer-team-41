'use server';

import { apiFetch } from '@/lib/api';
import { managedUserOf, type ManagedUser } from '@/lib/users';
import { requireAccount } from './auth-session';

/**
 * Действия раздела «Пользователи» и смены своего пароля. Как и соседние действия, ошибку отдают
 * значением: окну нужно знать, что именно не вышло. Кто вправе — решает API: чужой запрос к
 * администраторским маршрутам он отклоняет сам.
 */

export type UsersFailure = {
  readonly ok: false;
  /** `exists` — почта занята, `forbidden` — нельзя (себя, последнего администратора). */
  readonly reason: 'exists' | 'invalid' | 'forbidden' | 'notFound' | 'failed';
  /** Объяснение API, если оно есть: его показывают как есть. */
  readonly message?: string;
};

export type UsersResult =
  { readonly ok: true; readonly users: readonly ManagedUser[] } | UsersFailure;

export type UpdateMeResult = { readonly ok: true } | UsersFailure;

async function failureOf(response: Response): Promise<UsersFailure> {
  let message: string | undefined;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Без тела — хватит кода ответа.
  }
  const reason =
    response.status === 409
      ? 'exists'
      : response.status === 400
        ? 'invalid'
        : response.status === 403
          ? 'forbidden'
          : response.status === 404
            ? 'notFound'
            : 'failed';
  return { ok: false, reason, ...(message ? { message } : {}) };
}

async function list(): Promise<UsersResult> {
  const response = await apiFetch('/users');
  if (!response.ok) return failureOf(response);
  const rows = (await response.json()) as unknown[];
  return {
    ok: true,
    users: rows.map(managedUserOf).filter((user): user is ManagedUser => user !== null),
  };
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export async function listUsersAction(): Promise<UsersResult> {
  await requireAccount();
  return list();
}

export async function createUserAction(input: {
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'user';
}): Promise<UsersResult> {
  await requireAccount();
  const response = await apiFetch('/users', json('POST', input));
  if (!response.ok) return failureOf(response);
  return list();
}

export async function updateUserAction(
  userId: string,
  patch: {
    email?: string;
    name?: string;
    password?: string;
    role?: 'admin' | 'user';
    disabled?: boolean;
  },
): Promise<UsersResult> {
  await requireAccount();
  if (typeof userId !== 'string') return { ok: false, reason: 'invalid' };
  const response = await apiFetch(`/users/${encodeURIComponent(userId)}`, json('PATCH', patch));
  if (!response.ok) return failureOf(response);
  return list();
}

export async function deleteUserAction(userId: string): Promise<UsersResult> {
  await requireAccount();
  if (typeof userId !== 'string') return { ok: false, reason: 'invalid' };
  const response = await apiFetch(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  if (!response.ok) return failureOf(response);
  return list();
}

/** Сменить свой пароль, зная текущий. */
export async function changeOwnPasswordAction(
  currentPassword: string,
  password: string,
): Promise<UpdateMeResult> {
  await requireAccount();
  if (typeof currentPassword !== 'string' || typeof password !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const response = await apiFetch('/users/me', json('PATCH', { currentPassword, password }));
  return response.ok ? { ok: true } : failureOf(response);
}
