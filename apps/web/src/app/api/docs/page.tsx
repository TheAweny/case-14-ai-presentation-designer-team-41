import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DocsUnavailable } from '@/components/api-docs/docs-unavailable';
import {
  capabilityLead,
  capabilityTitle,
  guideLead,
  guideTitle,
  referenceTitle,
} from '@/components/api-docs/docs-labels';
import { API_PROXY_PATH } from '@/lib/api';
import { fetchBrowserDocument, tagDescription } from '@/lib/api-docs';
import {
  CAPABILITY_SLUGS,
  DOCS_TITLE_CLASS,
  GUIDE_SLUGS,
  REFERENCE_PAGES,
  SCHEMAS_SLUG,
} from '@/lib/docs-nav';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('apiDocs'), getTranslations('metadata')]);
  return { title: `${t('title')} · ${tMeta('title')}` };
}

const cardClass =
  'block h-full rounded-xl bg-card/40 px-4 py-3 ring-1 ring-border/70 backdrop-blur-sm transition-shadow hover:shadow-[0_0_24px_-8px_oklch(from_var(--project-purple)_l_c_h/0.55)]';

/** Обзор: что это за сервис, и карта статей и справочника. Swagger живёт на страницах тегов. */
export default async function ApiDocsPage() {
  const [t, document] = await Promise.all([getTranslations('apiDocs'), fetchBrowserDocument()]);
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
    <article className="px-4 py-8 sm:px-6 sm:py-10">
      <p className="font-mono text-xs tracking-wide text-muted-foreground">{t('eyebrow')}</p>
      <h1
        className={cn(
          'mt-3 max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance',
          DOCS_TITLE_CLASS,
        )}
      >
        {t('heading')}
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-pretty text-muted-foreground">
        {t('subtitle')}
      </p>

      {document ? (
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="bg-card/40 px-4 py-3 backdrop-blur-sm">
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="mt-1 truncate font-mono text-sm">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <DocsUnavailable />
      )}

      <section className="mt-10">
        <h2 className="text-xs font-medium text-muted-foreground">{t('capabilities')}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CAPABILITY_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/api/docs/guide/${slug}`} className={cardClass}>
                <span className="text-sm font-medium">{capabilityTitle(t, slug)}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {capabilityLead(t, slug)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium text-muted-foreground">{t('guide')}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {GUIDE_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/api/docs/guide/${slug}`} className={cardClass}>
                <span className="text-sm font-medium">{guideTitle(t, slug)}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {guideLead(t, slug)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-medium text-muted-foreground">{t('reference')}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {REFERENCE_PAGES.map((page) => {
            const description = document ? tagDescription(document, page.tag) : undefined;
            return (
              <li key={page.slug}>
                <Link href={`/api/docs/reference/${page.slug}`} className={cardClass}>
                  <span className="text-sm font-medium">{referenceTitle(t, page.slug)}</span>
                  {description ? (
                    <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li>
            <Link href={`/api/docs/reference/${SCHEMAS_SLUG}`} className={cardClass}>
              <span className="text-sm font-medium">{referenceTitle(t, SCHEMAS_SLUG)}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{t('schemasLead')}</span>
            </Link>
          </li>
        </ul>
      </section>
    </article>
  );
}
