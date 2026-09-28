import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FolderIcon } from '@/components/ui/icons';
import { CreateProjectButton } from '@/components/library/create-project-dialog';
import { CardGrid, EmptyState, LibraryPage } from '@/components/library/page-parts';
import { ProjectCard } from '@/components/library/project-card';
import { librarySource } from '@/mocks/sources';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('library'), getTranslations('metadata')]);
  return { title: t('projectsPage.documentTitle', { app: tMeta('title') }) };
}

/**
 * Все проекты. В боковой панели остаются только закреплённые: сюда приходят, чтобы создать
 * проект, открыть его или закрепить. Порядок — недавно изменённые сверху, как отдаёт источник.
 */
export default async function ProjectsPage() {
  const [t, projects] = await Promise.all([
    getTranslations('library'),
    librarySource.listProjects(),
  ]);

  return (
    <LibraryPage>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('projectsPage.title')}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t('projectsPage.subtitle')}</p>
        </div>
        <CreateProjectButton className="w-full shrink-0 sm:w-auto" />
      </header>

      {projects.length > 0 ? (
        <CardGrid>
          {projects.map((project) => (
            <li key={project.projectId} className="min-w-0">
              <ProjectCard project={project} />
            </li>
          ))}
        </CardGrid>
      ) : (
        <EmptyState icon={FolderIcon} title={t('projectsPage.emptyTitle')}>
          {t('projectsPage.emptyBody')}
        </EmptyState>
      )}
    </LibraryPage>
  );
}
