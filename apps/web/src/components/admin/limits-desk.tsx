'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'motion/react';
import type { AccountLimit, AccountPolicy, AccountUsageView, PolicyMetric } from '@lct/contracts';
import {
  readAccountUsageAction,
  revokeAccountSessionsAction,
  saveAccountPolicyAction,
} from '@/app/account-policy-actions';
import { listUsersAction } from '@/app/users-actions';
import { AccountAvatar } from '@/components/auth/account-menu';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon, SearchIcon, SpinnerIcon } from '@/components/ui/icons';
import { Slider } from '@/components/ui/slider';
import type { ManagedUser } from '@/lib/users';
import {
  POLICY_METRICS,
  SHARED_POLICY_SCOPE,
  countSliderMax,
  fromUnitAmount,
  isPeriodic,
  localTimezone,
  setLimit,
  setMode,
  shownMode,
  samePolicy,
  storageSliderMax,
  storageUnitFor,
  timezoneOptions,
  toUnitAmount,
  usageRatio,
  type LimitMode,
  type StorageUnit,
} from '@/lib/policy-draft';
import { cn } from '@/lib/utils';
import { Segmented } from './segmented';

const ease = [0.16, 1, 0.3, 1] as const;

/**
 * Ограничения установки: общая политика и личная подмена для человека. Значение крутят
 * ползунком, хранение — в КБ, МБ или ГБ, период — сегментами, пояс — из списка.
 */
export function LimitsDesk() {
  const t = useTranslations('admin.limits');
  const [users, setUsers] = useState<readonly ManagedUser[] | null>(null);
  const [scope, setScope] = useState(SHARED_POLICY_SCOPE);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    listUsersAction().then(
      (result) => {
        if (live && result.ok) setUsers(result.users);
        else if (live) setUsers([]);
      },
      () => live && setUsers([]),
    );
    return () => {
      live = false;
    };
  }, []);

  const needle = query.trim().toLocaleLowerCase();
  const visible = (users ?? []).filter((user) => {
    if (needle === '') return true;
    return `${user.name} ${user.email}`.toLocaleLowerCase().includes(needle);
  });

  return (
    <section aria-label={t('title')} className="flex flex-col gap-6">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {scope === SHARED_POLICY_SCOPE ? t('everyoneHint') : t('personalHint')}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="grid gap-2">
          {users && users.length > 6 ? (
            <label className="relative block">
              <SearchIcon
                size={14}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className={cn(
                  'h-11 w-full rounded-md bg-muted/70 pr-3 pl-8 text-base outline-none md:h-9 md:text-sm',
                  'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                )}
              />
            </label>
          ) : null}
          <div
            role="radiogroup"
            aria-label={t('scope')}
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
          >
            <ScopeChip
              checked={scope === SHARED_POLICY_SCOPE}
              label={t('everyone')}
              onSelect={() => setScope(SHARED_POLICY_SCOPE)}
            />
            {users === null ? (
              <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
                {t('loading')}
              </p>
            ) : (
              visible.map((user) => (
                <ScopeChip
                  key={user.userId}
                  checked={scope === user.userId}
                  label={`${user.name} ${user.email}`}
                  onSelect={() => setScope(user.userId)}
                >
                  <AccountAvatar account={user} className="size-6" />
                  <span className="grid min-w-0 text-left">
                    <span className="truncate text-sm">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                </ScopeChip>
              ))
            )}
          </div>
        </div>
        <LimitEditor key={scope} scope={scope} />
      </div>
    </section>
  );
}

function ScopeChip({
  checked,
  label,
  onSelect,
  children,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={children ? label : undefined}
      onClick={onSelect}
      className={cn(
        'flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm outline-none lg:w-full',
        'transition-[background-color,box-shadow,color] duration-200 motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        checked
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
    >
      {children ?? label}
    </button>
  );
}

function LimitEditor({ scope }: { scope: string }) {
  const t = useTranslations('admin.limits');
  const shared = scope === SHARED_POLICY_SCOPE;
  const [view, setView] = useState<AccountUsageView | null>(null);
  const [draft, setDraft] = useState<AccountPolicy>({});
  const [saved, setSaved] = useState<AccountPolicy>({});
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  const [tone, setTone] = useState<'ok' | 'error'>('ok');
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    setView(null);
    setFailed(false);
    setStatus('');
    readAccountUsageAction(scope).then(
      (value) => {
        if (!live) return;
        const policy = shared ? value.defaults : value.override;
        setView(value);
        setDraft(policy);
        setSaved(policy);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [scope, shared]);

  const dirty = !samePolicy(draft, saved);

  const report = (kind: 'ok' | 'error', text: string) => {
    setTone(kind);
    setStatus(text);
  };

  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('loadFailed')}
      </p>
    );
  }
  if (!view) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
        {t('loading')}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul className="grid gap-3 md:grid-cols-2">
        {POLICY_METRICS.map((metric, index) => (
          <MetricCard
            key={metric}
            index={index}
            metric={metric}
            view={view}
            draft={draft}
            shared={shared}
            busy={busy}
            onDraft={setDraft}
          />
        ))}
      </ul>
      <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-background/95 px-3 py-2 shadow-lg ring-1 ring-border backdrop-blur-md">
        <p
          role="status"
          className={cn(
            'min-h-5 text-sm',
            tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {status}
        </p>
        <div className="flex flex-wrap gap-2">
          {shared ? null : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await revokeAccountSessionsAction(scope);
                  report(result.ok ? 'ok' : 'error', result.ok ? t('revoked') : t('revokeFailed'));
                })
              }
            >
              {t('revoke')}
            </Button>
          )}
          <Button
            disabled={!dirty || busy}
            onClick={() =>
              start(async () => {
                try {
                  const result = await saveAccountPolicyAction(scope, draft);
                  if (result.ok) {
                    const policy = shared ? result.view.defaults : result.view.override;
                    setView(result.view);
                    setDraft(policy);
                    setSaved(policy);
                    report('ok', t('saved'));
                  } else report('error', result.message);
                } catch {
                  report('error', t('invalid'));
                }
              })
            }
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  index,
  metric,
  view,
  draft,
  shared,
  busy,
  onDraft,
}: {
  index: number;
  metric: PolicyMetric;
  view: AccountUsageView;
  draft: AccountPolicy;
  shared: boolean;
  busy: boolean;
  onDraft: (policy: AccountPolicy) => void;
}) {
  const t = useTranslations('admin');
  const limits = useTranslations('admin.limits');
  const reduce = useReducedMotion();
  const name = t(`metrics.${metric}`);
  const mode = shownMode(draft, metric, shared);
  const row = view.metrics.find((item) => item.metric === metric);
  const used =
    metric === 'storage'
      ? view.storageBytes
      : metric === 'concurrency'
        ? (row?.active ?? 0)
        : (row?.completed ?? 0);
  const config = draft[metric];
  const inherited = view.defaults[metric];
  const active = mode === 'limited' ? config : mode === 'inherit' ? inherited : null;
  const ratio = usageRatio(used, active?.limit ?? null);
  const zone = localTimezone();

  return (
    <motion.li
      role="group"
      aria-label={name}
      className="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/15 p-4 ring-1 ring-border"
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : index * 0.04, ease }}
    >
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{name}</h3>
        <p className="text-xs text-pretty text-muted-foreground">{t(`metricHints.${metric}`)}</p>
      </div>
      <UsageLine
        metric={metric}
        used={used}
        active={row?.active ?? 0}
        limit={active}
        ratio={ratio}
      />
      <Segmented<LimitMode>
        label={limits('modes.label', { metric: name })}
        value={mode}
        disabled={busy}
        options={(shared
          ? (['unlimited', 'limited'] as const)
          : (['inherit', 'unlimited', 'limited'] as const)
        ).map((id) => ({ id, label: limits(`modes.${id}`) }))}
        onChange={(next) => onDraft(setMode(draft, metric, next, zone))}
      />
      <AnimatedCollapse open={mode === 'limited' && Boolean(config)} id={`limit-${metric}`}>
        {config ? (
          <LimitControls
            metric={metric}
            name={name}
            config={config}
            busy={busy}
            onChange={(patch) => onDraft(setLimit(draft, metric, patch))}
          />
        ) : null}
      </AnimatedCollapse>
    </motion.li>
  );
}

function UsageLine({
  metric,
  used,
  active,
  limit,
  ratio,
}: {
  metric: PolicyMetric;
  used: number;
  active: number;
  limit: AccountLimit | null | undefined;
  ratio: number | null;
}) {
  const t = useTranslations('admin.limits');
  const format = useFormatter();
  const amount = metric === 'storage' ? formatStorage(used, t) : format.number(used);
  const cap = limit
    ? metric === 'storage'
      ? formatStorage(limit.limit, t)
      : format.number(limit.limit)
    : null;
  const over = limit != null && limit.limit > 0 && used >= limit.limit;
  return (
    <div className="grid gap-1.5">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {t('used', { used: amount })}
          {metric !== 'storage' && metric !== 'concurrency'
            ? ` · ${t('running', { count: format.number(active) })}`
            : ''}
        </span>
        <span className="tabular-nums">
          {cap ? t('ofLimit', { limit: cap }) : t('modes.unlimited')}
        </span>
      </p>
      {ratio === null ? null : (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full origin-left rounded-full transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
              over ? 'bg-destructive' : 'bg-foreground',
            )}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      )}
    </div>
  );
}

function LimitControls({
  metric,
  name,
  config,
  busy,
  onChange,
}: {
  metric: PolicyMetric;
  name: string;
  config: AccountLimit;
  busy: boolean;
  onChange: (patch: Partial<AccountLimit>) => void;
}) {
  const t = useTranslations('admin.limits');
  const storage = metric === 'storage';
  const [unit, setUnit] = useState<StorageUnit>(() => storageUnitFor(config.limit));
  const amount = storage ? toUnitAmount(config.limit, unit) : config.limit;
  const max = storage ? storageSliderMax(amount, unit) : countSliderMax(amount);
  const step = storage && unit === 'gb' ? 0.1 : 1;

  const writeAmount = (next: number) => {
    onChange({ limit: storage ? fromUnitAmount(next, unit) : next });
  };

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <AmountField
          label={t('value', { metric: name })}
          amount={amount}
          step={step}
          disabled={busy}
          onAmount={writeAmount}
        />
        {storage ? (
          <Segmented<StorageUnit>
            label={t('unit', { metric: name })}
            value={unit}
            disabled={busy}
            className="w-auto"
            options={(['kb', 'mb', 'gb'] as const).map((id) => ({ id, label: t(`units.${id}`) }))}
            onChange={setUnit}
          />
        ) : null}
      </div>
      <Slider
        aria-label={t('value', { metric: name })}
        min={0}
        max={max}
        step={step}
        disabled={busy}
        value={[Math.min(amount, max)]}
        onValueChange={([next]) => writeAmount(next ?? 0)}
        className="h-8"
      />
      {isPeriodic(metric) ? (
        <Segmented
          label={t('period', { metric: name })}
          value={config.period}
          disabled={busy}
          options={(['lifetime', 'day', 'month'] as const).map((id) => ({
            id,
            label: t(`periods.${id}`),
          }))}
          onChange={(period) => onChange({ period })}
        />
      ) : null}
      {isPeriodic(metric) && config.period !== 'lifetime' ? (
        <TimezoneField
          label={t('timezone', { metric: name })}
          value={config.timezone}
          disabled={busy}
          onChange={(timezone) => onChange({ timezone })}
        />
      ) : null}
      {config.limit === 0 ? <p className="text-xs text-muted-foreground">{t('zero')}</p> : null}
    </div>
  );
}

function AmountField({
  label,
  amount,
  step,
  disabled,
  onAmount,
}: {
  label: string;
  amount: number;
  step: number;
  disabled: boolean;
  onAmount: (amount: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? String(amount);
  return (
    <label className="grid gap-0.5">
      <input
        aria-label={label}
        type="number"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        min={0}
        step={step}
        disabled={disabled}
        value={shown}
        onFocus={() => setText(shown)}
        onBlur={() => setText(null)}
        onChange={(event) => {
          setText(event.currentTarget.value);
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onAmount(Math.max(0, next));
        }}
        className={cn(
          'h-11 w-32 rounded-md bg-background px-2.5 text-lg font-semibold tabular-nums outline-none md:h-10',
          'ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        )}
      />
    </label>
  );
}

function TimezoneField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (timezone: string) => void;
}) {
  const options = useMemo(() => timezoneOptions(value), [value]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled}
        aria-label={label}
        className={cn(
          'inline-flex h-11 items-center gap-1.5 self-start rounded-md border border-border bg-background px-3 text-base outline-none',
          'focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:h-8 md:text-sm',
        )}
      >
        <span className="truncate">{value}</span>
        <ChevronDownIcon size={14} className="shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((zone) => (
            <DropdownMenuRadioItem key={zone} value={zone} className="max-md:min-h-11">
              {zone}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatStorage(
  bytes: number,
  t: (key: 'units.kb' | 'units.mb' | 'units.gb', values?: Record<string, string>) => string,
): string {
  const unit = storageUnitFor(bytes);
  return `${toUnitAmount(bytes, unit)} ${t(`units.${unit}`)}`;
}
