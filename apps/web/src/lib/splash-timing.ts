/**
 * Когда показывать и убирать заставку загрузки. Быстрая загрузка проходит без неё вовсе, а
 * показавшаяся заставка не мигает: держится не меньше `SPLASH_MIN_SHOWN_MS`.
 *
 * Время — в миллисекундах `performance.now()`.
 */

/** Раньше этого заставка не проявляется: переход быстрее — человек её не увидит. */
export const SPLASH_DELAY_MS = 200;
/** Проявившаяся заставка держится хотя бы столько, иначе она мелькнёт. */
export const SPLASH_MIN_SHOWN_MS = 500;
/** Одна заставка сменила другую не дольше чем за это время — для человека это одна заставка. */
export const SPLASH_HANDOFF_MS = 150;

/**
 * Сколько ещё держать заставку, когда всё готово: `since` — когда её начали показывать,
 * `now` — сейчас. null — заставка ещё не успела проявиться, убрать её можно сразу.
 */
export function splashHoldMs(since: number, now: number): number | null {
  const visibleAt = since + SPLASH_DELAY_MS;
  if (now < visibleAt) return null;
  return Math.max(0, visibleAt + SPLASH_MIN_SHOWN_MS - now);
}

/**
 * Через сколько проявить заставку, начатую в `since`. null — она уже на экране и
 * проявляться заново не должна.
 */
export function splashFadeDelayMs(since: number, now: number): number | null {
  const left = since + SPLASH_DELAY_MS - now;
  return left > 0 ? Math.round(left) : null;
}

/**
 * Эстафета между заставками. Заставка `loading.tsx` маршрута и заставка самой страницы —
 * разные элементы, но для человека это одна заставка: вторая продолжает отсчёт первой, а не
 * проявляется заново и не держится свои полсекунды сверху.
 */
export interface SplashRelay {
  /** Заставка открылась в `now`: с какого момента считать её показанной. Состояние не меняет. */
  start(now: number): number;
  /** Заставка, начатая в `since`, ушла с экрана в `now`, не доиграв. */
  leave(since: number, now: number): void;
}

export function createSplashRelay(): SplashRelay {
  let last: { since: number; left: number } | null = null;
  return {
    // Чтение без записи: React в строгом режиме вызывает инициализатор состояния дважды.
    start: (now) => (last && now - last.left <= SPLASH_HANDOFF_MS ? last.since : now),
    leave: (since, now) => {
      last = { since, left: now };
    },
  };
}
