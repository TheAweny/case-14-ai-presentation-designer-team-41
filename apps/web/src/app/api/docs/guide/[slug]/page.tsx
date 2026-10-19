import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { articleTitle } from '@/components/api-docs/docs-labels';
import { GuideMarkdown } from '@/components/api-docs/guide-markdown';
import { DOCS_TITLE_CLASS, isArticleSlug } from '@/lib/docs-nav';
import { readGuide } from '@/lib/guide';
import { cn } from '@/lib/utils';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const [t, tMeta] = await Promise.all([getTranslations('apiDocs'), getTranslations('metadata')]);
  if (!isArticleSlug(slug)) return { title: tMeta('title') };
  return { title: `${articleTitle(t, slug)} · ${tMeta('title')}` };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isArticleSlug(slug)) notFound();
  const t = await getTranslations('apiDocs');

  return (
    <article className="max-w-3xl px-4 py-8 sm:px-6">
      <h1 className={cn('text-3xl font-semibold tracking-tight', DOCS_TITLE_CLASS)}>
        {articleTitle(t, slug)}
      </h1>
      <div className="mt-4">
        <GuideMarkdown
          text={readGuide(slug)}
          cards={slug === 'decisions' || slug === 'assistant'}
        />
      </div>
    </article>
  );
}
