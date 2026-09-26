'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Узкий экран: колонки редактора складываются в одну. Та же граница, что у `max-md:` в Tailwind. */
export const NARROW_SCREEN = '(max-width: 767px)';

/**
 * Совпадает ли медиазапрос сейчас. На сервере экрана нет, поэтому до гидратации ответ —
 * `serverValue`, а вёрстка, которая не должна прыгать, решается в CSS, а не здесь.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
