import { getTranslations } from 'next-intl/server';

/** Shown where the page would draw the live OpenAPI document, while the API is down. */
export async function DocsUnavailable() {
  const t = await getTranslations('apiDocs');
  return (
    <section role="alert" aria-label={t('unavailable.title')} className="mt-6">
      <div className="rounded-xl bg-card p-5 ring-1 ring-destructive/40">
        <h2 className="text-sm font-semibold">{t('unavailable.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('unavailable.description')}</p>
      </div>
    </section>
  );
}
