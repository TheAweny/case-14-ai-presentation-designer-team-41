import { getTranslations } from 'next-intl/server';
import { LibraryPageSkeleton } from '@/components/library/page-skeletons';

/** Страница меню собирается на сервере: боковая панель уже на месте, справа — заготовка. */
export default async function LibraryLoading() {
  const t = await getTranslations('splash');
  return <LibraryPageSkeleton label={t('page')} />;
}
