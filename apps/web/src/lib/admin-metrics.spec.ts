import { describe, expect, it } from 'vitest';
import { comparableTotal, filterAdminUsers, type AdminMetricRow } from './admin-metrics';
import type { AccountUsageView } from '@lct/contracts';
import type { ManagedUser } from './users';

const user: ManagedUser = {
  userId: 'ada',
  name: 'Ада Лавлейс',
  email: 'ada@example.test',
  role: 'user',
  disabled: false,
  createdAt: 0,
  avatar: null,
};
function row(start: string, end: string | null = null): AdminMetricRow {
  const usage: AccountUsageView = {
    defaults: {},
    override: {},
    effective: {},
    storageBytes: 10,
    metrics: [{ metric: 'generation', limit: null, start, end, completed: 3, active: 0 }],
  };
  return { user, usage };
}
describe('admin metric comparability', () => {
  it('sums only matching reporting windows', () => {
    expect(comparableTotal([row('1970'), row('1970')], 'generation')?.completed).toBe(6);
    expect(comparableTotal([row('1970'), row('2026')], 'generation')).toBeNull();
    expect(comparableTotal([row('2026', '2027'), row('2026', '2028')], 'generation')).toBeNull();
  });
  it('keeps failed accounts and absent counters unknown', () => {
    expect(comparableTotal([row('1970'), { user, usage: null }], 'generation')).toBeNull();
    expect(comparableTotal([row('1970')], 'edit')).toBeNull();
    expect(comparableTotal([], 'generation')).toBeNull();
  });
});
describe('admin user search', () => {
  const users = [
    user,
    { ...user, userId: 'grace', name: 'Грейс', role: 'admin' as const, disabled: true },
  ];
  it('combines search, role and access status', () => {
    expect(filterAdminUsers(users, ' АДА ', 'user', 'active')).toEqual([user]);
    expect(filterAdminUsers(users, 'example.test', 'admin', 'disabled')).toEqual([users[1]]);
    expect(filterAdminUsers(users, '', 'admin', 'active')).toEqual([]);
  });
});
