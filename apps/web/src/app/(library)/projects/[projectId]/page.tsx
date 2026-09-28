import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getNow, getTranslations } from 'next-intl/server';
import { DeckIcon, PlusIcon } from '@/components/ui/icons';
import { DeckComposer } from '@/components/composer/deck-composer';
import { Button } from '@/components/ui/button';
import { DeckCard } from '@/components/library/deck-card';
import { DeckRow } from '@/components/library/deck-row';
import { EmptyState, LibraryPage } from '@/components/library/page-parts';
import { DeckBrowser } from '@/components/project/deck-browser';
import { ProjectHeader } from '@/components/project/project-header';
import { ProjectTabs } from '@/components/project/project-tabs';
import { ProjectTemplates } from '@/components/project/project-templates';
import { TemplateEmptyState } from '@/components/project/template-attach';
import { TemplatePanel } from '@/components/project/template-panel';
import { templateThumbOf } from '@/components/project/template-thumb';
import { isComposeRequested, newDeckInProjectHref, COMPOSE_PARAM } from '@/lib/library-menu';
import { ProjectNotFoundError, type ProjectSummary } from '@/lib/library-source';
import { librarySource } from '@/mocks/sources';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: SearchParams;
}

/** Проект по id из адреса; неизвестный id — страница 404, остальные ошибки летят дальше. */
async function loadProject(projectId: string): Promise<ProjectSummary> {
  try {
    return await librarySource.getProject(projectId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const { projectId } = await params;
  const [project, t, tMeta] = await Promise.all([
    loadProject(projectId),
    getTranslations('projectPage'),
    getTranslations('metadata'),
  ]);
  return { title: t('documentTitle', { project: project.name, app: tMeta('title') }) };
}

/**
 * Страница проекта: шапка с иконкой и именем, быстрый старт новой презентации и вкладки —
 * презентации проекта и его шаблоны. Данные грузит сервер, он же считает относительное время и
 * рисует профили шаблонов; клиентские части только переключают, ищут и сохраняют правки.
 *
 * Проект без шаблонов начинается с шаблона: презентации проекта собираются по его шаблонам, и
 * вместо пустого списка обе вкладки предлагают прикрепить шаблон.
 */
export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const project = await loadProject(projectId);
  const [t, format, now, decks, projects, templates] = await Promise.all([
    getTranslations('projectPage'),
    getFormatter(),
    getNow(),
    librarySource.listDecks({ projectId: project.projectId }),
    librarySource.listProjects(),
    librarySource.listTemplates(),
  ]);
  const newDeckHref = newDeckInProjectHref(project.projectId);
  // Обложку каждой колоды рисует её шаблон: в проекте их может быть несколько, а колода может
  // быть свёрстана и шаблоном, который уже открепили.
  const templateById = new Map(templates.map((template) => [template.templateId, template]));
  const covered = decks.flatMap((deck) => {
    const template = templateById.get(deck.templateId);
    return template ? [{ deck, designSystem: template.designSystem }] : [];
  });
  const attached = new Set(project.templates.map((template) => template.templateId));
  // Из чего выбрать в «Прикрепить шаблон»: библиотека без уже прикреплённых.
  const library = templates
    .filter((template) => !attached.has(template.templateId))
    .map(templateThumbOf);
  const attachFirst =
    project.templates.length === 0 ? (
      <TemplateEmptyState
        // Другой проект — другой импорт: зона загрузки начинается заново.
        key={`attach-${project.projectId}`}
        projectId={project.projectId}
        library={library}
      />
    ) : null;
  const edited = new Date(project.updatedAt);

  return (
    <LibraryPage>
      <div className="flex flex-col gap-6">
        <ProjectHeader
          // Другой проект — другие черновики имени и открытая панель: начинаем заново.
          key={project.projectId}
          projectId={project.projectId}
          name={project.name}
          appearance={project.appearance}
          deckCount={project.deckCount}
          pinned={project.pinned}
          meta={{
            templates: t('header.templates', { count: project.templates.length }),
            decks: t('header.decks', { count: project.deckCount }),
            edited: t('header.edited', { time: format.relativeTime(edited, now) }),
            editedIso: edited.toISOString(),
          }}
          newDeckHref={newDeckHref}
        />
        {/*
         * Поле есть и у проекта без шаблонов: шаблон можно взять из библиотеки или приложить
         * файлом, а кнопка шаблона подскажет, что выбрать его нужно.
         */}
        <DeckComposer
          // Другой проект — другое поле: текст и вложения начинаются заново.
          key={`composer-${project.projectId}`}
          templates={templates}
          projects={projects}
          projectId={project.projectId}
          focusRequested={isComposeRequested(query[COMPOSE_PARAM])}
        />
      </div>

      <ProjectTabs
        key={`tabs-${project.projectId}`}
        deckCount={decks.length}
        templateCount={project.templates.length}
        decks={
          <DeckBrowser
            items={covered.map(({ deck, designSystem }) => ({
              deckId: deck.deckId,
              title: deck.title,
              updatedAt: deck.updatedAt,
              card: <DeckCard deck={deck} designSystem={designSystem} />,
              row: <DeckRow deck={deck} designSystem={designSystem} />,
            }))}
            empty={
              attachFirst ?? (
                <EmptyState
                  icon={DeckIcon}
                  title={t('empty.title')}
                  action={
                    <Button asChild variant="outline">
                      <Link href={newDeckHref}>
                        <PlusIcon data-icon="inline-start" />
                        {t('newDeck')}
                      </Link>
                    </Button>
                  }
                >
                  {t('empty.body')}
                </EmptyState>
              )
            }
          />
        }
        templates={
          attachFirst ?? (
            <ProjectTemplates
              key={`templates-${project.projectId}`}
              projectId={project.projectId}
              templates={project.templates.map((template) => ({
                ...templateThumbOf(template),
                panel: <TemplatePanel template={template} />,
              }))}
              library={library}
            />
          )
        }
      />
    </LibraryPage>
  );
}
