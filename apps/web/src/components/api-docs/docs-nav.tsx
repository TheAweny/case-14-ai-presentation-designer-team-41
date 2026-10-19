'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { capabilityTitle, guideTitle, referenceTitle } from '@/components/api-docs/docs-labels';
import { cn } from '@/lib/utils';
import {
  CAPABILITY_SLUGS,
  GUIDE_SLUGS,
  REFERENCE_PAGES,
  SCHEMAS_SLUG,
  type DocsReferenceSlug,
} from '@/lib/docs-nav';

const itemClass =
  'block rounded-md px-2 py-1 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';

function Item({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const current = pathname === href;
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={cn(
        itemClass,
        current
          ? 'bg-card/50 font-medium text-foreground shadow-[0_0_0_1px_oklch(from_var(--project-purple)_l_c_h/0.5)]'
          : 'text-muted-foreground hover:bg-card/40 hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 gap-1 md:flex-col">
      <p className="px-2 py-1 text-xs text-muted-foreground">{title}</p>
      <ul className="flex gap-1 md:flex-col">{children}</ul>
    </div>
  );
}

/** Section list. On a narrow screen it scrolls sideways; from `md` it sticks under the header. */
export function DocsNav() {
  const t = useTranslations('apiDocs');
  const reference: { slug: DocsReferenceSlug; href: string }[] = [
    ...REFERENCE_PAGES.map((page) => ({
      slug: page.slug,
      href: `/api/docs/reference/${page.slug}`,
    })),
    { slug: SCHEMAS_SLUG, href: `/api/docs/reference/${SCHEMAS_SLUG}` },
  ];

  return (
    <aside className="border-b border-border/50 md:sticky md:top-14 md:max-h-[calc(100dvh-3.5rem)] md:w-56 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
      <nav
        aria-label={t('navLabel')}
        className="flex gap-4 overflow-x-auto px-4 py-3 md:flex-col md:gap-6 md:px-3 md:py-6"
      >
        <Item href="/api/docs" label={t('overview')} />
        <Group title={t('capabilities')}>
          {CAPABILITY_SLUGS.map((slug) => (
            <li key={slug}>
              <Item href={`/api/docs/guide/${slug}`} label={capabilityTitle(t, slug)} />
            </li>
          ))}
        </Group>
        <Group title={t('guide')}>
          {GUIDE_SLUGS.map((slug) => (
            <li key={slug}>
              <Item href={`/api/docs/guide/${slug}`} label={guideTitle(t, slug)} />
            </li>
          ))}
        </Group>
        <Group title={t('reference')}>
          {reference.map((page) => (
            <li key={page.slug}>
              <Item href={page.href} label={referenceTitle(t, page.slug)} />
            </li>
          ))}
        </Group>
      </nav>
    </aside>
  );
}
