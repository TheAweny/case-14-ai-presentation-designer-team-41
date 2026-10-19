'use server';

import { accountUsageViewSchema } from '@lct/contracts';
import { apiFetch } from '@/lib/api';
import { managedUserOf } from '@/lib/users';
import type { AdminMetricRow, AdminMetricSnapshot } from '@/lib/admin-metrics';
import { requireAccount } from './auth-session';

/** One browser request; bounded API fan-out avoids serial Next Server Action requests. */
export async function readAdminMetricsAction(): Promise<AdminMetricSnapshot> {
  const account = await requireAccount();
  if (account.role !== 'admin') throw new Error('Доступ только администратору.');
  const response = await apiFetch('/users', { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Не удалось загрузить пользователей.');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Некорректный список пользователей.');
  const users = data.map(managedUserOf);
  if (users.some((user) => user === null)) throw new Error('Некорректный аккаунт.');
  const rows: AdminMetricRow[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, users.length) }, async () => {
      while (cursor < users.length) {
        const user = users[cursor++];
        if (!user) continue;
        try {
          const usage = await apiFetch(`/account-usage/${encodeURIComponent(user.userId)}`, {
            signal: AbortSignal.timeout(15_000),
          });
          if (!usage.ok) throw new Error('Не удалось загрузить активность.');
          rows.push({ user, usage: accountUsageViewSchema.parse(await usage.json()) });
        } catch {
          rows.push({ user, usage: null });
        }
      }
    }),
  );
  return { rows, fetchedAt: Date.now() };
}
