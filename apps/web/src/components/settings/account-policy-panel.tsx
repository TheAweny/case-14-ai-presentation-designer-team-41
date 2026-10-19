'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import type { AccountLimit, AccountUsageView, PolicyMetric } from '@lct/contracts';
import { readAccountUsageAction } from '@/app/account-policy-actions';
import { useAccount } from '@/components/auth/account-context';
import { ADMIN_LIMITS_HREF } from '@/lib/library-menu';
import { isPeriodic, storageUnitFor, toUnitAmount, usageRatio } from '@/lib/policy-draft';
import { cn } from '@/lib/utils';

/**
 * Своя активность в разделе «Аккаунт»: сколько уже сделано и какой лимит включил администратор.
 * Меняют лимиты на панели администрирования, не здесь.
 */
export function AccountPolicyPanel() {
  const t = useTranslations('admin.usage');
  const metrics = useTranslations('admin.metrics');
  const limits = useTranslations('admin.limits');
  const format = useFormatter();
  const account = useAccount();
  const [view, setView] = useState<AccountUsageView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    readAccountUsageAction().then(
      (value) => live && setView(value),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <section aria-label={t('title')} className="grid gap-3 border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="max-w-xl text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {account?.role === 'admin' ? (
          <Link
            href={ADMIN_LIMITS_HREF}
            className="text-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {t('manage')}
          </Link>
        ) : null}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : view === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {view.metrics.map((row) => {
            const used =
              row.metric === 'storage'
                ? view.storageBytes
                : row.metric === 'concurrency'
                  ? row.active
                  : row.completed;
            const ratio = usageRatio(used, row.limit?.limit);
            return (
              <li key={row.metric} className="grid gap-1.5 border-t border-border py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                  <span>{metrics(row.metric)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {describe(row.metric, used, row.active, row.limit, t, limits, format)}
                  </span>
                </div>
                {isPeriodic(row.metric) && row.limit?.period !== 'lifetime' && row.end ? (
                  <p className="text-xs text-muted-foreground">
                    {t('resets', {
                      when: format.dateTime(new Date(row.end), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: row.limit?.timezone,
                      }),
                    })}{' '}
                    ({row.limit?.timezone})
                  </p>
                ) : null}
                {ratio === null ? null : (
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full origin-left rounded-full',
                        used >= (row.limit?.limit ?? 0) ? 'bg-destructive' : 'bg-foreground',
                      )}
                      style={{ transform: `scaleX(${ratio})` }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function describe(
  metric: PolicyMetric,
  used: number,
  active: number,
  limit: AccountLimit | null,
  usage: ReturnType<typeof useTranslations<'admin.usage'>>,
  limits: ReturnType<typeof useTranslations<'admin.limits'>>,
  format: ReturnType<typeof useFormatter>,
): string {
  const spent = metric === 'storage' ? storageLabel(used, limits) : format.number(used);
  const running =
    metric === 'storage' || metric === 'concurrency'
      ? ''
      : ` · ${usage('running', { count: format.number(active) })}`;
  if (!limit) return `${spent}${running} · ${usage('unlimited')}`;
  const cap = metric === 'storage' ? storageLabel(limit.limit, limits) : format.number(limit.limit);
  const period =
    isPeriodic(metric) && limit.period !== 'lifetime'
      ? ` ${limits(`periods.${limit.period}`)}`
      : '';
  const left = Math.max(
    0,
    limit.limit - used - (metric === 'concurrency' || metric === 'storage' ? 0 : active),
  );
  const remaining =
    metric === 'storage' ? '' : ` · ${usage('remaining', { count: format.number(left) })}`;
  return `${spent}${running} · ${cap}${period}${remaining}`;
}

function storageLabel(
  bytes: number,
  limits: ReturnType<typeof useTranslations<'admin.limits'>>,
): string {
  const unit = storageUnitFor(bytes);
  return `${toUnitAmount(bytes, unit)} ${limits(`units.${unit}`)}`;
}
