import {
  policyMetricSchema,
  type AccountLimit,
  type AccountPolicy,
  type PolicyMetric,
} from '@lct/contracts';

/**
 * Черновик ограничений до отправки. В политике нет ключа — человек наследует общую;
 * null — явно без ограничения; объект — лимит. Хранение измеряется в байтах, параллельные
 * сборки и хранение не сбрасываются по календарю. Модуль без React: это проверяют тесты.
 */

export const POLICY_METRICS = policyMetricSchema.options;
export const SHARED_POLICY_SCOPE = 'default';

export type LimitMode = 'inherit' | 'unlimited' | 'limited';
export type StorageUnit = 'kb' | 'mb' | 'gb';

export const STORAGE_UNIT_BYTES: Readonly<Record<StorageUnit, number>> = {
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

const PERIODIC = new Set<PolicyMetric>(['generation', 'assistant-response', 'image', 'edit']);

export function isPeriodic(metric: PolicyMetric): boolean {
  return PERIODIC.has(metric);
}

type PolicyEntry = 'missing' | null | AccountLimit;

function entry(policy: AccountPolicy, metric: PolicyMetric): PolicyEntry {
  if (!Object.prototype.hasOwnProperty.call(policy, metric)) return 'missing';
  return policy[metric] ?? null;
}

export function limitMode(policy: AccountPolicy, metric: PolicyMetric): LimitMode {
  const value = entry(policy, metric);
  if (value === 'missing') return 'inherit';
  return value === null ? 'unlimited' : 'limited';
}

/**
 * У общей политики не у кого наследовать: отсутствующий ключ показывается как «без ограничения»
 * и не считается правкой, пока его не тронули.
 */
export function shownMode(policy: AccountPolicy, metric: PolicyMetric, shared: boolean): LimitMode {
  const mode = limitMode(policy, metric);
  return shared && mode === 'inherit' ? 'unlimited' : mode;
}

export function samePolicy(left: AccountPolicy, right: AccountPolicy): boolean {
  return POLICY_METRICS.every((metric) => {
    const a = entry(left, metric);
    const b = entry(right, metric);
    if (a === 'missing' || b === 'missing' || a === null || b === null) return a === b;
    return a.limit === b.limit && a.period === b.period && a.timezone === b.timezone;
  });
}

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Стартовое значение, когда ограничение только что включили. */
export function blankLimit(metric: PolicyMetric, timezone: string): AccountLimit {
  if (metric === 'storage')
    return { limit: STORAGE_UNIT_BYTES.gb, period: 'lifetime', timezone: 'UTC' };
  if (metric === 'concurrency') return { limit: 2, period: 'lifetime', timezone: 'UTC' };
  return { limit: 50, period: 'month', timezone: isTimezone(timezone) ? timezone : 'UTC' };
}

export function setMode(
  policy: AccountPolicy,
  metric: PolicyMetric,
  mode: LimitMode,
  timezone: string,
): AccountPolicy {
  const next: AccountPolicy = { ...policy };
  if (mode === 'inherit') {
    delete next[metric];
    return next;
  }
  if (mode === 'unlimited') {
    next[metric] = null;
    return next;
  }
  next[metric] = next[metric] ?? blankLimit(metric, timezone);
  return next;
}

export function setLimit(
  policy: AccountPolicy,
  metric: PolicyMetric,
  patch: Partial<AccountLimit>,
): AccountPolicy {
  const current = policy[metric];
  if (!current) return policy;
  const nextLimit: AccountLimit = { ...current, ...patch };
  if (!isPeriodic(metric) || nextLimit.period === 'lifetime') {
    nextLimit.period = 'lifetime';
    nextLimit.timezone = 'UTC';
  }
  nextLimit.limit = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(nextLimit.limit)));
  return { ...policy, [metric]: nextLimit };
}

/** Единица, в которой целое число байт читается короче всего. */
export function storageUnitFor(bytes: number): StorageUnit {
  if (bytes > 0 && bytes % STORAGE_UNIT_BYTES.gb === 0) return 'gb';
  if (bytes > 0 && bytes % STORAGE_UNIT_BYTES.mb === 0) return 'mb';
  if (bytes >= STORAGE_UNIT_BYTES.gb) return 'gb';
  if (bytes >= STORAGE_UNIT_BYTES.mb) return 'mb';
  return 'kb';
}

export function toUnitAmount(bytes: number, unit: StorageUnit): number {
  return Math.round((bytes / STORAGE_UNIT_BYTES[unit]) * 100) / 100;
}

export function fromUnitAmount(amount: number, unit: StorageUnit): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.round(amount * STORAGE_UNIT_BYTES[unit]));
}

/** Верх ползунка растёт вместе со значением, но не заставляет тянуть через тысячи делений. */
export function countSliderMax(value: number): number {
  const steps = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 50000];
  return steps.find((step) => step >= Math.max(0, value)) ?? 50000;
}

export function storageSliderMax(amount: number, unit: StorageUnit): number {
  const floor = unit === 'gb' ? 10 : unit === 'mb' ? 512 : 1024;
  const value = Math.max(0, amount);
  if (value <= floor) return floor;
  return unit === 'gb' ? Math.ceil(value) : Math.ceil(value / 64) * 64;
}

export const TIMEZONES = [
  'UTC',
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Shanghai',
] as const;

export function timezoneOptions(current: string): readonly string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const zone of [localTimezone(), current, ...TIMEZONES]) {
    if (!zone || seen.has(zone) || !isTimezone(zone)) continue;
    seen.add(zone);
    options.push(zone);
  }
  return options;
}

/** Доля использованного лимита, 0…1. Ноль в лимите шкалу не рисует. */
export function usageRatio(used: number, limit: number | null | undefined): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.min(1, Math.max(0, used) / limit);
}
