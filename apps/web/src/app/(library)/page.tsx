import { getTranslations } from 'next-intl/server';
import { DeckIcon } from '@/components/ui/icons';
import { DeckComposer } from '@/components/composer/deck-composer';
import { DeckCard } from '@/components/library/deck-card';
import { CardGrid, EmptyState, LibraryPage, LibrarySection } from '@/components/library/page-parts';
import { COMPOSE_PARAM, isComposeRequested } from '@/lib/library-menu';
import { librarySource } from '@/mocks/sources';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Главная: поле генерации и недавние презентации с обложками. История чатов и закреплённые
 * проекты — в боковой панели, все проекты — на своей странице. С `?compose=1` (кнопка
 * «Новая презентация») поле сразу в фокусе. Презентация, начатая здесь, живёт вне проектов;
 * шаблон для неё — любой из библиотеки или новый файл прямо в поле.
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
  // Обложку рисует профиль колоды, а без него — профиль её шаблона; без обоих рисовать нечем.
  const recent = decks.flatMap((deck) => {
    const designSystem = deck.designSystem ?? templateById.get(deck.templateId)?.designSystem;
    const project = deck.projectId === null ? undefined : projectById.get(deck.projectId);
    return designSystem ? [{ deck, designSystem, project }] : [];
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
            {recent.map(({ deck, designSystem, project }) => (
              <li key={deck.deckId} className="min-w-0">
                <DeckCard
                  deck={deck}
                  designSystem={designSystem}
                  // Вне проектов — так и подписано: в «Недавних» видно, где презентация лежит.
                  projectName={project?.name ?? t('deckCard.noProject')}
                />
              </li>
            ))}
          </CardGrid>
        ) : (
          <EmptyState icon={DeckIcon} title={t('recentEmpty.title')}>
            {t('recentEmpty.body')}
          </EmptyState>
        )}
      </LibrarySection>
    </LibraryPage>
  );
}
