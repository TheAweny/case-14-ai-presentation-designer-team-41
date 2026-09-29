import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { EDITOR_PREFS_COOKIE, parseEditorPrefs } from '@/components/editor/editor-prefs';
import { EditorPrefsProvider } from '@/components/editor/use-editor-prefs';
import { AccountProvider } from '@/components/auth/account-context';
import { NavigationProgress } from '@/components/navigation-progress';
import { SettingsHost } from '@/components/settings/settings-dialog';
import { ServiceStatus } from '@/components/service-status';
import { currentAccount } from './auth-session';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, cookieStore, account] = await Promise.all([
    getLocale(),
    cookies(),
    currentAccount().catch(() => null),
  ]);
  const editorPrefs = parseEditorPrefs(cookieStore.get(EDITOR_PREFS_COOKIE)?.value);

  return (
    <html lang={locale} className="dark">
      <body className="min-h-dvh font-sans">
        {/* Словарь и язык провайдер берёт из запроса сам: клиентские компоненты видят тот же. */}
        <NextIntlClientProvider>
          <AccountProvider account={account}>
            <EditorPrefsProvider initial={editorPrefs}>
              <NavigationProgress>
                {children}
                <ServiceStatus />
                {/* Окно настроек открывается параметром адреса на любой странице — и в редакторе. */}
                <Suspense fallback={null}>
                  <SettingsHost />
                </Suspense>
              </NavigationProgress>
            </EditorPrefsProvider>
          </AccountProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
