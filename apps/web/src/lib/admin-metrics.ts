import type { AccountUsageView, OperationMetric } from '@lct/contracts';
import type { ManagedUser } from './users';

export interface AdminMetricRow {
  readonly user: ManagedUser;
  readonly usage: AccountUsageView | null;
}

export interface AdminMetricSnapshot {
  readonly rows: readonly AdminMetricRow[];
  readonly fetchedAt: number;
}

/** Missing accounts or counters are unknown. Only identical windows may be added. */
export function comparableTotal(rows: readonly AdminMetricRow[], metric: OperationMetric) {
  if (rows.length === 0) return null;
  const counters = rows.map((row) => row.usage?.metrics.find((item) => item.metric === metric));
  const first = counters[0];
  if (!first || counters.some((row) => !row || row.start !== first.start || row.end !== first.end))
    return null;
  return {
    completed: counters.reduce((sum, row) => sum + (row?.completed ?? 0), 0),
    start: first.start,
    end: first.end,
  };
}

export function filterAdminUsers(
  users: readonly ManagedUser[],
  query: string,
  role: 'all' | 'admin' | 'user',
  status: 'all' | 'active' | 'disabled',
) {
  const needle = query.trim().toLocaleLowerCase();
  return users.filter(
    (user) =>
      (role === 'all' || user.role === role) &&
      (status === 'all' || user.disabled === (status === 'disabled')) &&
      `${user.name} ${user.email}`.toLocaleLowerCase().includes(needle),
  );
}
