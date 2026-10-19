import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { docsUrl } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(docsUrl()),
  title: {
    default: 'Документация',
    template: '%s — Документация',
  },
  description:
    'Документация цифрового дизайнера презентаций: как создать колоду, развернуть сервис и подключиться к API.',
};

export const viewport: Viewport = { themeColor: '#17181b' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-fd-primary focus:px-3 focus:py-2 focus:text-fd-primary-foreground"
        >
          К содержанию
        </a>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
