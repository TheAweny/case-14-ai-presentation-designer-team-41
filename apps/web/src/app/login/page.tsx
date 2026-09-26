import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';
import { NEXT_PARAM, safeNextPath } from '@/lib/auth';
import { authSource } from '@/mocks/auth-source';
import { currentAccount } from '../auth-session';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('auth'), getTranslations('metadata')]);
  return { title: `${t('title')} · ${tMeta('title')}` };
}

/**
 * Страница входа. Вошедшего сразу отправляет дальше: proxy сюда не заглядывает, и только здесь
 * видно, жив ли ещё аккаунт за cookie.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)[NEXT_PARAM];
  const next = safeNextPath(typeof raw === 'string' ? raw : null);
  if (await currentAccount()) redirect(next);

  return <LoginForm next={next} hasAccounts={await authSource.hasAccounts()} />;
}
