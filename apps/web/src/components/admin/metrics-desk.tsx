'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AccountUsageView, OperationMetric } from '@lct/contracts';
import { readAdminMetricsAction } from '@/app/admin-metrics-actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { comparableTotal, type AdminMetricSnapshot } from '@/lib/admin-metrics';
import { storageUnitFor, toUnitAmount } from '@/lib/policy-draft';
import type { AdminView } from '@/lib/admin-views';

export function MetricsDesk({ onOpen }: { onOpen: (view: AdminView, accountId?: string) => void }) {
  const t = useTranslations('admin.metrics');
  const limits = useTranslations('admin.limits');
  const format = useFormatter();
  const [snapshot, setSnapshot] = useState<AdminMetricSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('storage');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setFailed(false);
    readAdminMetricsAction().then(
      (value) => {
        if (live) {
          setSnapshot(value);
          setLoading(false);
        }
      },
      () => {
        if (live) {
          setFailed(true);
          setLoading(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [revision]);

  const needle = query.trim().toLocaleLowerCase();
  const rows = (snapshot?.rows ?? [])
    .filter(({ user }) => `${user.name} ${user.email}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) =>
      sort === 'name'
        ? a.user.name.localeCompare(b.user.name)
        : (b.usage?.storageBytes ?? -1) - (a.usage?.storageBytes ?? -1),
    );
  const total = snapshot?.rows.length ?? 0;
  const loaded = snapshot?.rows.filter((row) => row.usage !== null).length ?? 0;
  const complete = rows.every((row) => row.usage !== null);
  const storage = (bytes: number) => {
    const unit = storageUnitFor(bytes);
    return `${format.number(toUnitAmount(bytes, unit))} ${limits(`units.${unit}`)}`;
  };
  const generation = comparableTotal(rows, 'generation');
  const replies = comparableTotal(rows, 'assistant-response');
  const summary = [
    { label: t('generations'), value: generation ? format.number(generation.completed) : '—' },
    { label: t('replies'), value: replies ? format.number(replies.completed) : '—' },
    {
      label: t('storage'),
      value:
        complete && rows.length
          ? storage(rows.reduce((sum, row) => sum + (row.usage?.storageBytes ?? 0), 0))
          : '—',
    },
  ];

  return (
    <section aria-label={t('title')} className="flex min-w-0 flex-col gap-5" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('methodology')}</p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {loading ? t('loading') : t('refresh')}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : null}
      {snapshot ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {t('coverage', { loaded, total })} ·{' '}
            {t('updated', {
              time: format.dateTime(snapshot.fetchedAt, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            })}
          </p>
          {loaded < total ? (
            <p role="alert" className="text-sm text-destructive">
              {t('partial')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid min-w-0 flex-1 gap-1 text-sm">
              <span>{t('search')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 min-w-0 rounded-md border border-border bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:text-sm"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('sort')}</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="h-11 rounded-md border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
              >
                <option value="storage">{t('sortStorage')}</option>
                <option value="name">{t('sortName')}</option>
              </select>
            </label>
          </div>
          <dl className="grid gap-4 border-y border-border py-4 sm:grid-cols-3">
            {summary.map(({ label, value }) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{t('totalsHint')}</p>
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {total === 0 ? t('empty') : t('noResults')}
            </p>
          ) : (
            <ul aria-label={t('accountList')} className="flex flex-col divide-y divide-border">
              {rows.map(({ user, usage }) => (
                <li
                  key={user.userId}
                  aria-label={t('rowLabel', { name: user.name })}
                  className="grid min-w-0 gap-4 py-5"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {user.name} {user.disabled ? `· ${t('disabled')}` : ''}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpen('limits', user.userId)}
                    >
                      {t('manage')}
                    </Button>
                  </div>
                  {usage ? (
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-5">
                      {(['generation', 'assistant-response', 'edit'] as const).map((metric) => (
                        <Counter key={metric} usage={usage} metric={metric} />
                      ))}
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('active')}</dt>
                        <dd className="mt-1 text-sm tabular-nums">
                          {usage.metrics.find((item) => item.metric === 'concurrency')?.active ??
                            '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">{t('storage')}</dt>
                        <dd className="mt-1 text-sm tabular-nums">{storage(usage.storageBytes)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-destructive">{t('accountFailed')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : loading ? (
        <div role="status" aria-label={t('loading')} className="grid gap-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : null}
    </section>
  );
}

function Counter({ usage, metric }: { usage: AccountUsageView; metric: OperationMetric }) {
  const t = useTranslations('admin.metrics');
  const limits = useTranslations('admin.limits');
  const format = useFormatter();
  const counter = usage.metrics.find((item) => item.metric === metric);
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{t(metric)}</dt>
      <dd className="mt-1 text-sm tabular-nums">
        {counter ? format.number(counter.completed) : '—'}
      </dd>
      {counter ? (
        <dd className="mt-1 text-xs text-muted-foreground">
          {counter.end === null ? (
            t('lifetime')
          ) : (
            <>
              {limits(`periods.${counter.limit?.period ?? 'lifetime'}`)} · {counter.limit?.timezone}
              <br />
              {format.dateTime(new Date(counter.start), {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: counter.limit?.timezone,
              })}{' '}
              —{' '}
              {format.dateTime(new Date(counter.end), {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: counter.limit?.timezone,
              })}
            </>
          )}
        </dd>
      ) : null}
    </div>
  );
}
