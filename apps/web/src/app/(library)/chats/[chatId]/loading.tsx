import { getTranslations } from 'next-intl/server';
import { ChatSkeleton } from '@/components/library/page-skeletons';

export default async function ChatLoading() {
  const t = await getTranslations('splash');
  return <ChatSkeleton label={t('page')} />;
}
