import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiReference } from '@/components/api-docs/api-reference';
import { DocsUnavailable } from '@/components/api-docs/docs-unavailable';
import { referenceTitle } from '@/components/api-docs/docs-labels';
import {
  documentForSchemas,
  documentForTag,
  fetchBrowserDocument,
  tagDescription,
} from '@/lib/api-docs';
import { DOCS_TITLE_CLASS, SCHEMAS_SLUG, isDocsReferenceSlug, referenceTag } from '@/lib/docs-nav';
import { cn } from '@/lib/utils';
import 'swagger-ui-dist/swagger-ui.css';
import '@/components/api-docs/api-docs.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  const [t, tMeta] = await Promise.all([getTranslations('apiDocs'), getTranslations('metadata')]);
  if (!isDocsReferenceSlug(tag)) return { title: tMeta('title') };
  return { title: `${referenceTitle(t, tag)} · ${tMeta('title')}` };
}

export default async function ReferencePage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  if (!isDocsReferenceSlug(tag)) notFound();
  const [t, document] = await Promise.all([getTranslations('apiDocs'), fetchBrowserDocument()]);
  const openApiTag = referenceTag(tag);
  const description =
    tag === SCHEMAS_SLUG
      ? t('schemasLead')
      : document && openApiTag
        ? tagDescription(document, openApiTag)
        : undefined;
  const spec =
    document === null
      ? null
      : tag === SCHEMAS_SLUG
        ? documentForSchemas(document)
        : documentForTag(document, openApiTag ?? tag);
  const operationCount = Object.keys(spec?.paths ?? {}).length;

  return (
    <article className="px-4 py-8 sm:px-6">
      <h1 className={cn('text-3xl font-semibold tracking-tight', DOCS_TITLE_CLASS)}>
        {referenceTitle(t, tag)}
      </h1>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {spec === null ? (
        <DocsUnavailable />
      ) : tag !== SCHEMAS_SLUG && operationCount === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t('tagMissing')}</p>
      ) : (
        <div className="mt-6">
          <ApiReference spec={spec} mode={tag === SCHEMAS_SLUG ? 'schemas' : 'operations'} />
        </div>
      )}
    </article>
  );
}
