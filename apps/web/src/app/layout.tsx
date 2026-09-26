import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { NavigationProgress } from '@/components/navigation-progress';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale} className="dark">
      <body className="min-h-dvh font-sans">
        {/* Словарь и язык провайдер берёт из запроса сам: клиентские компоненты видят тот же. */}
        <NextIntlClientProvider>
          <NavigationProgress>{children}</NavigationProgress>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
