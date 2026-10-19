import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AdminDashboard } from '@/components/admin/admin-dashboard';
import { LibraryPage } from '@/components/library/page-parts';
import { requireAccount } from '../../auth-session';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('admin'), getTranslations('metadata')]);
  return { title: t('documentTitle', { app: tMeta('title') }) };
}

/** Люди и ограничения. Обычный аккаунт этот адрес не видит. */
export default async function AdminPage() {
  const account = await requireAccount();
  if (account.role !== 'admin') notFound();
  return (
    <LibraryPage>
      <Suspense>
        <AdminDashboard />
      </Suspense>
    </LibraryPage>
  );
}
