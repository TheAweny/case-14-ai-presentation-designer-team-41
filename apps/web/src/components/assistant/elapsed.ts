'use client';

import { useEffect, useState } from 'react';

/** Длительность как на часах: «0:42», «4:05». Меньше секунды — «0:00». */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Текущее время, которое тикает, пока `active`: по нему идут часы идущей сборки. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
