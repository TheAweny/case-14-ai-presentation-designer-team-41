'use server';
import { accountPolicySchema, accountUsageViewSchema } from '@lct/contracts';
import { requireAccount } from './auth-session';
import { apiFetch } from '@/lib/api';

export async function readAccountUsageAction(id?: string) {
  const account = await requireAccount();
  if (id && account.role !== 'admin') throw new Error('Доступ только администратору.');
  const response = await apiFetch(`/account-usage/${id ? encodeURIComponent(id) : 'me'}`);
  if (!response.ok) throw new Error('Не удалось загрузить активность. Повторите попытку.');
  return accountUsageViewSchema.parse(await response.json());
}
export async function saveAccountPolicyAction(id: string, input: unknown) {
  const account = await requireAccount();
  if (account.role !== 'admin') throw new Error('Доступ только администратору.');
  const policy = accountPolicySchema.parse(input);
  const response = await apiFetch(`/account-usage/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(policy),
  });
  if (!response.ok)
    return { ok: false as const, message: 'Не удалось сохранить ограничения. Повторите попытку.' };
  return { ok: true as const, view: accountUsageViewSchema.parse(await response.json()) };
}
export async function revokeAccountSessionsAction(id: string) {
  const account = await requireAccount();
  if (account.role !== 'admin') return { ok: false };
  const response = await apiFetch(`/users/${encodeURIComponent(id)}/revoke-sessions`, {
    method: 'POST',
  });
  return { ok: response.ok };
}
