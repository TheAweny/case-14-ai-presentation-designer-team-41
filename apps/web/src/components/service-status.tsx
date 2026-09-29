'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { BackendServices, ServiceState } from '@/lib/service-health';

const POLL_INTERVAL_MS = 15_000;

export function ServiceStatus() {
  const t = useTranslations('serviceStatus');
  const [services, setServices] = useState<BackendServices | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const response = await fetch('/api/service-status', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401) {
        setServices(null);
        setCheckFailed(false);
        return;
      }
      if (!response.ok) throw new Error('Status request failed');
      const report = (await response.json()) as { services: BackendServices };
      if (
        !report.services ||
        !['api', 'engine', 'database'].every((key) =>
          ['ok', 'degraded', 'down', 'unknown'].includes(
            report.services[key as keyof BackendServices],
          ),
        )
      ) {
        throw new Error('Invalid status response');
      }
      setServices(report.services);
      setCheckFailed(false);
    } catch {
      setCheckFailed(true);
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const onOnline = () => void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [check]);

  const affected = services
    ? (Object.entries(services) as [keyof BackendServices, ServiceState][]).filter(
        ([, state]) => state !== 'ok',
      )
    : [];
  if (!checkFailed && affected.length === 0) return null;

  return (
    <section
      role="alert"
      aria-label={t('title')}
      className="fixed right-4 bottom-4 left-4 z-40 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-destructive/40 sm:left-auto sm:w-80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{checkFailed ? t('checkFailed') : t('title')}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('description')}</p>
        </div>
        <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full bg-destructive" />
      </div>
      {!checkFailed && affected.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {affected.map(([name, state]) => (
            <li key={name} className="flex justify-between gap-3">
              <span>{t(name)}</span>
              <span className="text-destructive">
                {t(state === 'unknown' ? 'unknown' : state === 'degraded' ? 'degraded' : 'down')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={checking}
        onClick={() => void check()}
        className="mt-3"
      >
        {checking ? t('checking') : t('retry')}
      </Button>
    </section>
  );
}
