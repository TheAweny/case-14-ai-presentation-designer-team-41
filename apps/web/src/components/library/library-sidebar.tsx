'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Add01Icon,
  Home01Icon,
  PresentationBarChart01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { openSettings, useSettingsShortcut } from '@/components/settings/open-settings';
import { SettingsButton } from '@/components/settings/settings-button';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateProjectDialog } from '@/components/library/create-project-dialog';
import { InlineNameInput } from '@/components/library/inline-name-input';
import { HIDE_REMOVED_ITEMS } from '@/components/library/page-parts';
import { ProjectActions, ProjectLook } from '@/components/library/project-actions';
import { NEW_DECK_HREF, projectHref } from '@/lib/library-menu';
import { PROJECT_NAME_MAX_LENGTH, type ProjectSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';

/**
 * Что сайдбару нужно о проекте. Профиль шаблона и макеты сюда не передаём: сайдбар есть
 * на каждой странице меню, и тащить их в каждую незачем.
 */
export type SidebarProject = Pick<
  ProjectSummary,
  'projectId' | 'name' | 'appearance' | 'deckCount'
>;

/**
 * Боковая панель главного меню: создание, главная и проекты. Проект помечен своей иконкой
 * и цветом — так проекты различаются с одного взгляда, как в ChatGPT. Правая кнопка и «⋯»
 * у проекта открывают его меню; имя там правится по месту. «+» у заголовка группы создаёт
 * проект.
 * На узком экране панель становится полосой сверху.
 */
export function LibrarySidebar({ projects }: { projects: readonly SidebarProject[] }) {
  const t = useTranslations('library');
  const tMenu = useTranslations('libraryMenu');
  const tSettings = useTranslations('settings');
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  useSettingsShortcut();

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 md:hidden">
        <Brand />
        <Button
          variant="ghost"
          size="icon"
          aria-label={tSettings('open')}
          className="ml-auto text-muted-foreground"
          onClick={() => openSettings()}
        >
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={1.5} />
        </Button>
        <Button asChild size="sm">
          <Link href={NEW_DECK_HREF}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
            {t('newDeck')}
          </Link>
        </Button>
      </header>

      <aside
        aria-label={t('label')}
        className="hidden w-60 shrink-0 flex-col gap-4 border-r border-border bg-sidebar px-3 py-4 md:flex"
      >
        <Brand className="self-center" />

        <Button asChild size="lg" className="justify-start">
          <Link href={NEW_DECK_HREF}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
            {t('newDeck')}
          </Link>
        </Button>

        <nav aria-label={t('navigation')} className="flex flex-col gap-0.5">
          <NavLink href="/" icon={Home01Icon} active={pathname === '/'}>
            {t('home')}
          </NavLink>
        </nav>

        <section
          aria-labelledby="library-projects"
          className="group/projects flex min-h-0 flex-col gap-1"
        >
          {/* Справа отступ как у «⋯» проектов: «+» стоит в одном столбце с ними. */}
          <div className="flex items-center justify-between gap-2 pr-1 pl-2">
            <h2
              id="library-projects"
              className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {t('projects')}
            </h2>
            <NewProjectButton
              label={t('newProject')}
              // Пока проектов нет, «+» — единственное, что есть в группе: прятать нечего.
              alwaysVisible={projects.length === 0}
              onClick={() => setCreating(true)}
            />
          </div>
          <ul className={cn('flex min-h-0 flex-col gap-0.5 overflow-y-auto', HIDE_REMOVED_ITEMS)}>
            {projects.map((project) => {
              const href = projectHref(project.projectId);
              return (
                <li key={project.projectId}>
                  <ProjectActions
                    project={project}
                    rename="inline"
                    buttonClassName="top-1/2 right-1 size-6 -translate-y-1/2"
                  >
                    {({ renaming, name, finish }) =>
                      renaming ? (
                        <div className="flex h-8 items-center gap-2 rounded-md bg-muted px-2">
                          <ProjectLook
                            appearance={project.appearance}
                            size="sm"
                            className="-ml-0.5"
                          />
                          <InlineNameInput
                            name={name}
                            label={tMenu('renameProject.label')}
                            maxLength={PROJECT_NAME_MAX_LENGTH}
                            onDone={finish}
                            className={cn(
                              '-mx-1 h-6 min-w-0 flex-1 rounded-sm bg-background px-1 text-sm',
                              'text-foreground ring-1 ring-ring outline-none',
                            )}
                          />
                        </div>
                      ) : (
                        <NavLink
                          href={href}
                          active={pathname === href}
                          // Справа место под «⋯»: на сенсорном экране кнопка видна всегда.
                          className="pointer-coarse:pr-8"
                        >
                          <ProjectLook
                            appearance={project.appearance}
                            size="sm"
                            className="-ml-0.5"
                          />
                          <span className="truncate">{name}</span>
                          <span
                            className={cn(
                              'ml-auto text-xs text-muted-foreground tabular-nums',
                              // Когда появляется «⋯», число уступает ей место.
                              'transition-opacity duration-100 motion-reduce:transition-none',
                              'group-focus-within/object:opacity-0 group-hover/object:opacity-0',
                              'pointer-coarse:opacity-100!',
                            )}
                          >
                            {project.deckCount}
                          </span>
                        </NavLink>
                      )
                    }
                  </ProjectActions>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-auto flex">
          <SettingsButton className="flex-1" />
        </div>
      </aside>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/**
 * «+» у заголовка «Проекты», как в ChatGPT: появляется, когда указатель над группой или кнопка
 * в фокусе, а на сенсорном экране видна всегда — навести там нечем. Место под кнопкой занято
 * всегда, поэтому, появляясь, она ничего не сдвигает.
 */
function NewProjectButton({
  label,
  alwaysVisible,
  onClick,
}: {
  label: string;
  alwaysVisible: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
              'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              'transition-[opacity,background-color,color] duration-100 motion-reduce:transition-none',
              !alwaysVisible &&
                'opacity-0 group-hover/projects:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Знак приложения: только иконка, без названия. Ведёт на главную, поэтому для чтения с экрана
 * назван по месту, куда ведёт.
 */
function Brand({ className }: { className?: string }) {
  const t = useTranslations('library');
  return (
    <Link
      href="/"
      aria-label={t('home')}
      title={t('home')}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-white ring-1 ring-white/10',
        // `muted` в тёмной теме того же тона, что и `accent`: наведение отмечаем рамкой.
        'transition-shadow duration-100 hover:ring-white/25 motion-reduce:transition-none',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <HugeiconsIcon icon={PresentationBarChart01Icon} size={20} strokeWidth={1.75} />
    </Link>
  );
}

function NavLink({
  href,
  icon,
  active,
  className,
  children,
}: {
  href: string;
  icon?: IconSvgElement;
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none',
        'text-muted-foreground transition-colors duration-100 motion-reduce:transition-none',
        'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        active && 'bg-muted text-foreground',
        className,
      )}
    >
      {icon ? <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} /> : null}
      {children}
    </Link>
  );
}
