import { getTranslations } from 'next-intl/server';
import { LibraryPage } from '@/components/library/page-parts';
import {
  CardGridSkeleton,
  ComposerSkeleton,
  PageSkeleton,
} from '@/components/library/page-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/** Проект: иконка и имя, поле генерации, вкладки и сетка презентаций. */
export default async function ProjectLoading() {
  const t = await getTranslations('splash');
  return (
    <PageSkeleton label={t('page')}>
      <LibraryPage>
        <div className="flex flex-col gap-6">
          <div className="flex items-start gap-3 sm:gap-4">
            <Skeleton className="size-12 shrink-0 rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <ComposerSkeleton />
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-9 w-64" />
          <CardGridSkeleton kind="deck" />
        </div>
      </LibraryPage>
    </PageSkeleton>
  );
}
