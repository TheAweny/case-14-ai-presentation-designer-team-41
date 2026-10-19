import type { ReactNode } from 'react';
import { DocsHeader } from '@/components/api-docs/docs-header';
import { DocsNav } from '@/components/api-docs/docs-nav';
import { currentAccount } from '../../auth-session';

export const dynamic = 'force-dynamic';

/**
 * Справочник: короткая шапка и оглавление. Звёзды те же, что на входе, без кромки планеты —
 * на длинной странице она закрывает текст. Вход не нужен.
 */
export default async function DocsLayout({ children }: { children: ReactNode }) {
  const account = await currentAccount().catch(() => null);
  return (
    <div className="relative isolate min-h-dvh bg-background text-foreground">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="horizon-stars" />
      </div>
      <DocsHeader name={account?.name ?? null} />
      <div className="mx-auto flex w-full max-w-6xl flex-col md:flex-row">
        <DocsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
