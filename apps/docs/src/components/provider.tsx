'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import { DocsSearchDialog } from '@/components/search';
import { uiTranslations } from '@/lib/translations';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{ enabled: false }}
      i18n={{ locale: 'ru', translations: uiTranslations }}
      search={{ SearchDialog: DocsSearchDialog }}
    >
      {children}
    </RootProvider>
  );
}
