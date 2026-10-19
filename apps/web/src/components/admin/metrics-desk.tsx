'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import type { AccountUsageView } from '@lct/contracts';
import { readAccountUsageAction } from '@/app/account-policy-actions';
import { listUsersAction } from '@/app/users-actions';
import { SpinnerIcon } from '@/components/ui/icons';
import {
  POLICY_METRICS,
  storageUnitFor,
  toUnitAmount,
  usageRatio,
  type StorageUnit,
} from '@/lib/policy-draft';
import type { ManagedUser } from '@/lib/users';
import { cn } from '@/lib/utils';

const ease = [0.16, 1, 0.3, 1] as const;

type ReadyRow = {
  readonly user: ManagedUser;
  readonly usage: AccountUsageView;
};

type MetricsState =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly rows: readonly ReadyRow[] };

/**
 * Показатели установки. Сводного запроса нет: каждый аккаунт читается отдельно, а суммы
 * считаются здесь. Позже опрос сможет заменить одна ручка — оболочка раздела не изменится.
 */
export function MetricsDesk() {
  const t = useTranslations('admin.metrics');
  const limits = useTranslations('admin.limits');
  const format = useFormatter();
  const reduce = useReducedMotion();
  const [state, setState] = useState<MetricsState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await listUsersAction();
        if (!live) return;
        if (!result.ok) {
          setState({ status: 'error' });
          return;
        }
        if (result.users.length === 0) {
          setState({ status: 'empty' });
          return;
        }
        // Сводной ручки пока нет: позже она заменит этот опрос, оболочка раздела не изменится.
        const settled = await Promise.all(
          result.users.map(async (user) => {
            try {
              return { user, usage: await readAccountUsageAction(user.userId) };
            } catch {
              return null;
            }
          }),
        );
        if (!live) return;
        const rows = settled.filter((row): row is ReadyRow => row !== null);
        setState(rows.length === 0 ? { status: 'error' } : { status: 'ready', rows });
      } catch {
        if (live) setState({ status: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const rows = state.status === 'ready' ? byStorage(state.rows) : [];
  const summary = summarize(rows);
  const largest = rows.reduce((max, row) => Math.max(max, row.usage.storageBytes), 0);
  const storage = (bytes: number) => formatStorage(bytes, (unit) => limits(`units.${unit}`));

  return (
    <section aria-label={t('title')} className="flex min-w-0 flex-col gap-6">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : state.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
          {t('loading')}
        </p>
      ) : state.status === 'empty' ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={t('generations')} value={format.number(summary.generations)} />
            <Tile label={t('replies')} value={format.number(summary.replies)} />
            <Tile label={t('storage')} value={storage(summary.storageBytes)} />
            <Tile label={t('limitedAccounts')} value={format.number(summary.limitedAccounts)} />
          </dl>
          <ul aria-label={t('accountList')} className="flex flex-col gap-2">
            {rows.map((row) => {
              const generations = completed(row.usage, 'generation');
              // Доля от самого большого аккаунта. Если места нет ни у кого, шкала пустая.
              const ratio = usageRatio(row.usage.storageBytes, largest) ?? 0;
              return (
                <li
                  key={row.user.userId}
                  aria-label={t('rowLabel', { name: row.user.name })}
                  className={cn(
                    'grid gap-2.5 rounded-xl px-4 py-3 ring-1 ring-border',
                    row.user.disabled && 'opacity-60',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                      <p className="truncate text-sm">{row.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.user.email}</p>
                    </div>
                    <dl className="flex shrink-0 gap-4 text-right">
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('generations')}</dt>
                        <dd className="text-sm tabular-nums">{format.number(generations)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('storage')}</dt>
                        <dd className="text-sm tabular-nums">{storage(row.usage.storageBytes)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <motion.div
                      className="h-full w-full origin-left rounded-full bg-foreground"
                      initial={reduce ? false : { scaleX: 0 }}
                      animate={{ scaleX: ratio }}
                      transition={{ duration: reduce ? 0 : 0.4, ease }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function Tile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl px-4 py-3 ring-1 ring-border">
      <dt className="text-sm text-pretty text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function byStorage(rows: readonly ReadyRow[]): ReadyRow[] {
  return [...rows].sort(
    (left, right) =>
      right.usage.storageBytes - left.usage.storageBytes ||
      left.user.name.localeCompare(right.user.name),
  );
}

function summarize(rows: readonly ReadyRow[]) {
  return rows.reduce(
    (total, row) => ({
      generations: total.generations + completed(row.usage, 'generation'),
      replies: total.replies + completed(row.usage, 'assistant-response'),
      storageBytes: total.storageBytes + row.usage.storageBytes,
      limitedAccounts: total.limitedAccounts + (hasEffectiveLimit(row.usage) ? 1 : 0),
    }),
    { generations: 0, replies: 0, storageBytes: 0, limitedAccounts: 0 },
  );
}

function completed(usage: AccountUsageView, metric: 'generation' | 'assistant-response'): number {
  return usage.metrics.find((row) => row.metric === metric)?.completed ?? 0;
}

/** Хотя бы один явный лимит в действующей политике: null — без ограничения. */
function hasEffectiveLimit(usage: AccountUsageView): boolean {
  return POLICY_METRICS.some((metric) => usage.effective[metric] != null);
}

function formatStorage(bytes: number, units: (unit: StorageUnit) => string): string {
  const unit = storageUnitFor(bytes);
  return `${toUnitAmount(bytes, unit)} ${units(unit)}`;
}
