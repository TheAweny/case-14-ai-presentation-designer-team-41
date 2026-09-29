import { getTranslations } from 'next-intl/server';
import { LibraryPage } from '@/components/library/page-parts';
import {
  CardGridSkeleton,
  HeaderSkeleton,
  PageSkeleton,
} from '@/components/library/page-skeletons';

export default async function TemplatesLoading() {
  const t = await getTranslations('splash');
  return (
    <PageSkeleton label={t('page')}>
      <LibraryPage>
        <HeaderSkeleton action />
        <CardGridSkeleton kind="template" />
      </LibraryPage>
    </PageSkeleton>
  );
}
