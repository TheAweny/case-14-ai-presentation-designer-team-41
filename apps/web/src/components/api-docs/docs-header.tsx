'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { loginHref } from '@/lib/auth';
import { DOCS_TITLE_CLASS } from '@/lib/docs-nav';
import { cn } from '@/lib/utils';

/** Short bar shared by every docs page: home, the app, the OpenAPI file, language, try-it-out. */
export function DocsHeader({ name }: { name: string | null }) {
  const t = useTranslations('apiDocs');
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b border-border/50 bg-background/40 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <Link href="/api/docs" className={cn('mr-auto text-sm font-semibold', DOCS_TITLE_CLASS)}>
          {t('title')}
        </Link>
        <Button asChild size="sm" variant="outline">
          <Link href="/">{t('openApp')}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href="/api/docs-json" download="openapi.json" className="font-mono">
            {t('download')}
          </a>
        </Button>
        <LocaleSwitcher />
        {name ? (
          <span className="max-w-56 truncate text-xs text-muted-foreground">
            {t('signedIn', { name })}
          </span>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link href={loginHref(pathname)}>{t('signIn')}</Link>
          </Button>
        )}
      </div>
    </header>
  );
}
