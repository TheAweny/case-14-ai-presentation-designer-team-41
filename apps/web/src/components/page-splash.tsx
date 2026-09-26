'use client';

import { useEffect, useRef, useState } from 'react';
import { Grid } from 'ldrs/react';
import 'ldrs/react/Grid.css';
import { cn } from '@/lib/utils';
import { createSplashRelay, splashFadeDelayMs, splashHoldMs } from '@/lib/splash-timing';

/** Сколько длится уход заставки; совпадает с `duration-200` ниже. */
const FADE_OUT_MS = 200;

/** Одна на вкладку: заставка маршрута передаёт отсчёт заставке страницы. */
const relay = createSplashRelay();

export interface PageSplashProps {
  /** Пока true, заставка закрывает страницу. Стала false — уходит, выдержав минимум показа. */
  busy?: boolean;
  /** Что загружается сейчас. */
  label: string;
  /** Доля готового от 0 до 1. Без неё полосы прогресса нет. */
  progress?: number;
}

/**
 * Заставка загрузки поверх всей страницы: страница не показывается, пока не готова целиком.
 * Проявляется только если загрузка дольше `SPLASH_DELAY_MS`, а проявившись, не мигает:
 * держится хотя бы `SPLASH_MIN_SHOWN_MS`. Страницу под ней можно смонтировать заранее —
 * заставка уйдёт плавно, и под ней окажется готовый кадр.
 *
 * Проявление — CSS-анимация с задержкой, поэтому при обновлении страницы заставка из
 * серверного HTML работает до гидратации.
 */
export function PageSplash({ busy = true, label, progress }: PageSplashProps) {
  const [start] = useState(() => {
    const now = performance.now();
    const since = relay.start(now);
    return { since, fadeDelay: splashFadeDelayMs(since, now) };
  });
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>('shown');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (busy) return;
    const hold = splashHoldMs(start.since, performance.now());
    // Не успела проявиться — уходит сразу, без затухания.
    if (hold === null) {
      const gone = window.setTimeout(() => setPhase('gone'), 0);
      return () => window.clearTimeout(gone);
    }
    const leaving = window.setTimeout(() => setPhase('leaving'), hold);
    const gone = window.setTimeout(() => setPhase('gone'), hold + FADE_OUT_MS);
    return () => {
      window.clearTimeout(leaving);
      window.clearTimeout(gone);
    };
  }, [busy, start.since]);

  // Ушла, не доиграв (маршрут сменил свою заставку на заставку страницы), — передаёт отсчёт.
  useEffect(
    () => () => {
      if (phaseRef.current !== 'gone') relay.leave(start.since, performance.now());
    },
    [start.since],
  );

  if (phase === 'gone') return null;

  return (
    <div
      role="status"
      aria-busy={busy}
      data-page-splash={phase}
      style={start.fadeDelay === null ? undefined : { animationDelay: `${start.fadeDelay}ms` }}
      className={cn(
        'fixed inset-0 z-50 grid place-items-center bg-background transition-opacity duration-200',
        start.fadeDelay !== null &&
          'animate-[splash-in_200ms_ease-out_both] motion-reduce:[animation-duration:1ms]',
        phase === 'leaving' && 'pointer-events-none opacity-0',
      )}
    >
      <div className="flex w-64 max-w-[80vw] flex-col items-center gap-5">
        <span aria-hidden className="motion-reduce:[&_*]:[animation-play-state:paused]">
          <Grid size={56} speed={1.5} color="var(--primary)" />
        </span>
        <p className="text-center text-sm text-muted-foreground">{label}</p>
        {progress === undefined ? null : (
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
