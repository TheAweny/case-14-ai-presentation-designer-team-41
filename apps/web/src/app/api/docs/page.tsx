import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiReference } from '@/components/api-docs/api-reference';
import { Button } from '@/components/ui/button';
import { API_PROXY_PATH } from '@/lib/api';
import { fetchBrowserDocument } from '@/lib/api-docs';
import { loginHref } from '@/lib/auth';
import { currentAccount } from '../../auth-session';
import 'swagger-ui-dist/swagger-ui.css';
import '@/components/api-docs/api-docs.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('apiDocs'), getTranslations('metadata')]);
  return { title: `${t('title')} · ${tMeta('title')}` };
}

/**
 * Описание API для людей: открыто без входа, как экспертам на проверке. Шапка — из того же
 * «Горизонта», что страница входа; ниже Swagger UI в цветах интерфейса. Вошедший может
 * пробовать запросы: они идут через `/api/backend` с его сессией.
 */
export default async function ApiDocsPage() {
  const [t, document, account] = await Promise.all([
    getTranslations('apiDocs'),
    fetchBrowserDocument(),
    currentAccount().catch(() => null),
  ]);
  const operations = Object.values(document?.paths ?? {}).reduce(
    (sum, item) => sum + Object.keys(item).length,
    0,
  );
  const info = document?.info as { version?: string } | undefined;
  const components = document?.components as { schemas?: object } | undefined;
  const facts = [
    { label: t('facts.version'), value: info?.version ?? '—' },
    { label: t('facts.operations'), value: String(operations) },
    { label: t('facts.schemas'), value: String(Object.keys(components?.schemas ?? {}).length) },
    { label: t('facts.server'), value: API_PROXY_PATH },
  ];

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="relative isolate overflow-hidden border-b border-border">
        <div aria-hidden className="horizon-stars" />
        <div aria-hidden className="api-docs-glow" />
        <div className="mx-auto max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
          <p className="font-mono text-xs tracking-wide text-muted-foreground">{t('eyebrow')}</p>
          <h1 className="mt-3 max-w-3xl bg-linear-to-b from-foreground from-30% to-[oklch(0.8_0.08_290)] bg-clip-text text-3xl leading-tight font-semibold tracking-tight text-balance text-transparent sm:text-[2.5rem]">
            {t('heading')}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-pretty text-muted-foreground">
            {t('subtitle')}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <Button asChild size="lg">
              <Link href="/">{t('openApp')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="/api/docs-json" download="openapi.json" className="font-mono">
                {t('download')}
              </a>
            </Button>
            {account ? (
              <span className="ml-1 text-xs text-muted-foreground">
                {t('signedIn', { name: account.name })}
              </span>
            ) : (
              <Button asChild size="lg" variant="ghost">
                <Link href={loginHref('/api/docs')}>{t('signIn')}</Link>
              </Button>
            )}
          </div>

          {document ? (
            <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="bg-card/80 px-4 py-3 backdrop-blur">
                  <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                  <dd className="mt-1 truncate font-mono text-sm">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </header>

      {document ? (
        <ApiReference spec={document} />
      ) : (
        <section
          role="alert"
          className="mx-auto mt-10 max-w-6xl px-4 sm:px-6"
          aria-label={t('unavailable.title')}
        >
          <div className="rounded-xl bg-card p-5 ring-1 ring-destructive/40">
            <h2 className="text-sm font-semibold">{t('unavailable.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('unavailable.description')}</p>
          </div>
        </section>
      )}
    </main>
  );
}
