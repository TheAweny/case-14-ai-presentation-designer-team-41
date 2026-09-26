'use client';

import type { ReactNode } from 'react';
import { ProgressProvider } from '@bprogress/next/app';
import { SPLASH_DELAY_MS } from '@/lib/splash-timing';

/**
 * Полоса перехода между страницами. Пока новая страница не пришла с сервера, на экране
 * остаётся старая, а полоса показывает, что клик принят; быстрые переходы проходят без неё.
 * Ссылки она видит сама, программные переходы — только через `useRouter` из
 * `@bprogress/next/app`. Листание слайдов идёт через `replaceState` и полосу не трогает.
 */
export function NavigationProgress({ children }: { children: ReactNode }) {
  return (
    <ProgressProvider
      color="var(--primary)"
      height="2px"
      delay={SPLASH_DELAY_MS}
      options={{ showSpinner: false }}
      shallowRouting
    >
      {children}
    </ProgressProvider>
  );
}
