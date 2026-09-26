import { getTranslations } from 'next-intl/server';
import { FolderLibraryIcon, Presentation01Icon } from '@hugeicons/core-free-icons';
import { DeckComposer } from '@/components/composer/deck-composer';
import { DeckCard } from '@/components/library/deck-card';
import { CardGrid, EmptyState, LibraryPage, LibrarySection } from '@/components/library/page-parts';
import { ProjectCard } from '@/components/library/project-card';
import { COMPOSE_PARAM, isComposeRequested } from '@/lib/library-menu';
import { librarySource } from '@/mocks/sources';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Главная: поле генерации, недавние презентации всех проектов и сами проекты. С `?compose=1`
 * (кнопка «Новая презентация») поле сразу в фокусе. Презентация, начатая здесь, живёт вне
 * проектов; шаблон для неё — любой из библиотеки или новый файл прямо в поле.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const [query, t, projects, decks, templates] = await Promise.all([
    searchParams,
    getTranslations('home'),
    librarySource.listProjects(),
    librarySource.listDecks(),
    librarySource.listTemplates(),
  ]);
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const templateById = new Map(templates.map((template) => [template.templateId, template]));
  // Обложку рисует профиль шаблона колоды: колоду без шаблона нечем нарисовать.
  const recent = decks.flatMap((deck) => {
    const template = templateById.get(deck.templateId);
    const project = deck.projectId === null ? undefined : projectById.get(deck.projectId);
    return template ? [{ deck, template, project }] : [];
  });

  return (
    <LibraryPage>
      <div className="flex flex-col gap-6">
        <header className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </header>

        {/* Шаблон загружают прямо в поле: скрепкой, перетаскиванием или из меню шаблона. */}
        <DeckComposer
          templates={templates}
          projects={projects}
          projectId={null}
          focusRequested={isComposeRequested(query[COMPOSE_PARAM])}
        />
      </div>

      <LibrarySection id="home-recent" title={t('recent')} count={recent.length}>
        {recent.length > 0 ? (
          <CardGrid>
            {recent.map(({ deck, template, project }) => (
              <li key={deck.deckId} className="min-w-0">
                <DeckCard
                  deck={deck}
                  designSystem={template.designSystem}
                  // Вне проектов — так и подписано: в «Недавних» видно, где презентация лежит.
                  projectName={project?.name ?? t('deckCard.noProject')}
                />
              </li>
            ))}
          </CardGrid>
        ) : (
          <EmptyState icon={Presentation01Icon} title={t('recentEmpty.title')}>
            {t('recentEmpty.body')}
          </EmptyState>
        )}
      </LibrarySection>

      <LibrarySection id="home-projects" title={t('projects')} count={projects.length}>
        {projects.length > 0 ? (
          <CardGrid>
            {projects.map((project) => (
              <li key={project.projectId} className="min-w-0">
                <ProjectCard project={project} />
              </li>
            ))}
          </CardGrid>
        ) : (
          <EmptyState icon={FolderLibraryIcon} title={t('projectsEmpty.title')}>
            {t('projectsEmpty.body')}
          </EmptyState>
        )}
      </LibrarySection>
    </LibraryPage>
  );
}
