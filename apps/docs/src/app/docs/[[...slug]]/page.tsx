import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) {
    if (!params.slug?.length) {
      return (
        <main id="content" className="mx-auto max-w-xl px-6 py-16">
          <h1 className="docs-title text-3xl font-semibold">Документация</h1>
          <p className="mt-4 text-fd-muted-foreground">
            Оглавление и три входа находятся на главной странице.
          </p>
          <Link href="/" className="mt-6 inline-block text-fd-primary">
            На главную
          </Link>
        </main>
      );
    }
    notFound();
  }

  const MDX = page.data.body;
  const wide = page.url.replace(/\/$/, '') === '/docs/api/console';
  return (
    <DocsPage toc={wide ? [] : page.data.toc} full={wide} tableOfContent={{ enabled: !wide }}>
      <div id="content">
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </div>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) return { title: 'Документация' };
  return { title: page.data.title, description: page.data.description };
}
