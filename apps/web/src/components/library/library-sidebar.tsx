'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { AccountMenu } from '@/components/auth/account-menu';
import { DeckActions, DeckTitle } from '@/components/library/deck-actions';
import { InlineNameInput } from '@/components/library/inline-name-input';
import { ProjectActions, ProjectLook } from '@/components/library/project-actions';
import { openSettings, useSettingsShortcut } from '@/components/settings/open-settings';
import { SettingsButton } from '@/components/settings/settings-button';
import { Button } from '@/components/ui/button';
import {
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/ui/icons';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { Account } from '@/lib/auth';
import {
  deckHref,
  NEW_DECK_HREF,
  newDeckInProjectHref,
  PROJECTS_HREF,
  projectHref,
} from '@/lib/library-menu';
import {
  PROJECT_NAME_MAX_LENGTH,
  type DeckSummary,
  type ProjectSummary,
} from '@/lib/library-source';
import { EXPANDED_PROJECTS_KEY, parseExpandedProjects } from '@/lib/sidebar-expanded';
import {
  buildSidebarLists,
  type HistoryDay,
  type PinnedRow,
  type SidebarDeckRef,
} from '@/lib/sidebar-history';
import { cn } from '@/lib/utils';

/**
 * Что сайдбару нужно о проекте. Профиль шаблона сюда не передаём: панель есть на каждой
 * странице меню, и тащить макеты в каждую незачем.
 */
export type SidebarProject = Pick<
  ProjectSummary,
  'projectId' | 'name' | 'appearance' | 'deckCount' | 'pinned' | 'pinnedAt'
>;

/** Презентация в истории: обложка рисуется на странице, в панели хватает названия. */
export type SidebarDeck = Pick<DeckSummary, 'deckId' | 'title' | 'projectId' | 'updatedAt'>;

/**
 * Боковая панель меню. Сверху — поиск, под ним новая презентация и переход ко всем проектам. Дальше
 * закреплённые проекты (раскрываются в свои презентации) и история всех остальных чатов,
 * от последнего к первому, по дням. На узком экране та же панель выезжает слева.
 */
export function LibrarySidebar({
  projects,
  decks,
  now,
  account,
}: {
  projects: readonly SidebarProject[];
  decks: readonly SidebarDeck[];
  /** Момент отрисовки страницы, мс. Дни истории считаются от него, чтобы сервер и клиент сошлись. */
  now: number;
  account: Account;
}) {
  const t = useTranslations('library');
  const tSettings = useTranslations('settings');
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const fallbackId = useMemo(() => {
    const pinned = projects
      .filter((project) => project.pinned)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
    return pinned[0]?.projectId ?? null;
  }, [projects]);
  const expanded = useOpenProjects(fallbackId);
  useSettingsShortcut();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const bodyProps = {
    projects,
    decks,
    now,
    account,
    query,
    onQuery: setQuery,
    openProjects: expanded.open,
    onToggleProject: expanded.toggle,
  };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('openMenu')}
          aria-expanded={menuOpen}
          aria-controls="library-menu"
          onClick={() => setMenuOpen(true)}
        >
          <MenuIcon />
        </Button>
        <AccountMenu account={account} compact className="ml-auto" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={tSettings('open')}
          className="text-muted-foreground"
          onClick={() => openSettings()}
        >
          <SettingsIcon />
        </Button>
        <Button asChild size="sm">
          <Link href={NEW_DECK_HREF}>
            <PlusIcon data-icon="inline-start" />
            {t('newDeck')}
          </Link>
        </Button>
      </header>

      <aside
        aria-label={t('label')}
        className="hidden h-dvh w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block"
      >
        <SidebarBody {...bodyProps} />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          id="library-menu"
          aria-label={t('label')}
          className="bg-sidebar text-sidebar-foreground ring-sidebar-border"
        >
          <SheetTitle className="sr-only">{t('label')}</SheetTitle>
          <SidebarBody
            {...bodyProps}
            className="min-h-0 flex-1"
            onNavigate={() => setMenuOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * Какие закреплённые проекты раскрыты. Пока человек не выбирал, раскрыт первый.
 * Выбор пишется в localStorage; если хранилище недоступно, он живёт до закрытия вкладки.
 */
function useOpenProjects(fallbackId: string | null) {
  const [stored, setStored] = useState<readonly string[] | null>(null);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    if (touched.current) return;
    setStored(parseExpandedProjects(window.localStorage.getItem(EXPANDED_PROJECTS_KEY)));
    setReady(true);
  }, []);

  const open = useMemo(() => {
    if (!ready || stored === null) return new Set(fallbackId ? [fallbackId] : []);
    return new Set(stored);
  }, [ready, stored, fallbackId]);

  const toggle = (projectId: string) => {
    touched.current = true;
    const next = new Set(open);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    const list = [...next];
    setStored(list);
    setReady(true);
    try {
      window.localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify(list));
    } catch {
      // Приватный режим не даёт записать выбор. До закрытия вкладки он и так в состоянии.
    }
  };

  return { open, toggle };
}

function SidebarBody({
  projects,
  decks,
  now,
  account,
  query,
  onQuery,
  openProjects,
  onToggleProject,
  onNavigate,
  className,
}: {
  projects: readonly SidebarProject[];
  decks: readonly SidebarDeck[];
  now: number;
  account: Account;
  query: string;
  onQuery: (query: string) => void;
  openProjects: ReadonlySet<string>;
  onToggleProject: (projectId: string) => void;
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations('library');
  const pathname = usePathname();
  const searching = query.trim() !== '';
  const lists = useMemo(
    () =>
      buildSidebarLists({
        projects,
        decks,
        openProjectIds: openProjects,
        query,
        now,
      }),
    [projects, decks, openProjects, query, now],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 flex-col gap-2 px-2 pt-3 pb-2">
        <HistorySearch query={query} onQuery={onQuery} />
        <nav aria-label={t('navigation')} className="flex flex-col gap-px">
          <NavRow
            href={NEW_DECK_HREF}
            active={false}
            onNavigate={onNavigate}
            icon={<PlusIcon size={16} />}
            className="text-foreground"
          >
            {t('newDeck')}
          </NavRow>
          <NavRow
            href={PROJECTS_HREF}
            active={pathname === PROJECTS_HREF}
            onNavigate={onNavigate}
            icon={<FolderIcon size={16} />}
          >
            {t('projects')}
          </NavRow>
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-2 pb-3 [scrollbar-width:thin]">
        {lists.searchMiss ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">{t('searchEmpty')}</p>
        ) : (
          <>
            <section aria-label={t('pinned')} className="flex flex-col">
              <h2 className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{t('pinned')}</h2>
              {lists.pinnedVacant ? (
                <p className="px-2 pb-1 text-xs leading-5 text-muted-foreground">
                  {t('pinnedEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-px">
                  {lists.pinned.map((row) => (
                    <PinnedProject
                      key={row.project.projectId}
                      row={row}
                      searching={searching}
                      onToggle={onToggleProject}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              )}
            </section>

            {lists.historyVacant ? (
              <section aria-label={t('history')}>
                <h2 className="sr-only">{t('history')}</h2>
                <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
                  {t('historyEmpty')}
                </p>
              </section>
            ) : lists.groups.length > 0 ? (
              <section aria-label={t('history')} className="mt-2">
                <h2 className="sr-only">{t('history')}</h2>
                {lists.groups.map((group) => (
                  <div key={group.day.kind === 'date' ? group.day.at : group.day.kind}>
                    <h3 className="sticky top-0 z-10 bg-sidebar px-2 pt-3 pb-1 text-xs text-muted-foreground">
                      <DayLabel day={group.day} now={now} />
                    </h3>
                    <ul className="flex flex-col gap-px">
                      {group.items.map((deck) => (
                        <li key={deck.deckId}>
                          <HistoryDeck deck={deck} onNavigate={onNavigate} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-2 py-2">
        <AccountMenu account={account} className="min-w-0 flex-1" />
        <SettingsButton iconOnly className="size-8" />
      </div>
    </div>
  );
}

function HistorySearch({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const t = useTranslations('library');
  return (
    <div className="relative">
      <SearchIcon
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="text"
        role="searchbox"
        value={query}
        placeholder={t('search')}
        aria-label={t('searchLabel')}
        autoComplete="off"
        spellCheck={false}
        // Chrome может дописать caret-color на поле до гидрации.
        suppressHydrationWarning
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || query === '') return;
          event.preventDefault();
          event.stopPropagation();
          onQuery('');
        }}
        className={cn(
          'h-8 w-full rounded-md bg-muted/70 pr-7 pl-7 text-sm text-foreground outline-none',
          'placeholder:text-muted-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      />
      {query !== '' ? (
        <button
          type="button"
          aria-label={t('clearSearch')}
          onClick={() => onQuery('')}
          className={cn(
            'absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md',
            'text-muted-foreground outline-none hover:text-foreground',
            'focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <CloseIcon size={14} />
        </button>
      ) : null}
    </div>
  );
}

function PinnedProject({
  row,
  searching,
  onToggle,
  onNavigate,
}: {
  row: PinnedRow<SidebarProject, SidebarDeck>;
  searching: boolean;
  onToggle: (projectId: string) => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations('library');
  const tMenu = useTranslations('libraryMenu');
  const pathname = usePathname();
  const project = row.project;
  const href = projectHref(project.projectId);
  const active = pathname === href;

  return (
    <li>
      <ProjectActions
        project={project}
        rename="inline"
        buttonClassName={MENU_BUTTON}
        className={cn('flex items-center rounded-md hover:bg-muted', active && 'bg-muted')}
      >
        {({ renaming, name, finish }) =>
          renaming ? (
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 px-1.5">
              <ProjectLook appearance={project.appearance} size="sm" />
              <InlineNameInput
                name={name}
                label={tMenu('renameProject.label')}
                maxLength={PROJECT_NAME_MAX_LENGTH}
                onDone={finish}
                className={cn(
                  'h-6 min-w-0 flex-1 rounded-sm bg-background px-1 text-sm text-foreground',
                  'ring-1 ring-ring outline-none',
                )}
              />
            </div>
          ) : (
            <>
              <button
                type="button"
                aria-expanded={row.open}
                aria-label={t(row.open ? 'collapseProject' : 'expandProject', { name })}
                onClick={() => onToggle(project.projectId)}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
                  'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                )}
              >
                <ChevronRightIcon
                  size={14}
                  className={cn(
                    'transition-transform duration-150 motion-reduce:transition-none',
                    row.open && 'rotate-90',
                  )}
                />
              </button>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                title={name}
                onClick={onNavigate}
                className={cn(
                  'flex h-8 min-w-0 flex-1 items-center gap-2 pr-7 text-sm outline-none',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring/50',
                )}
              >
                <ProjectLook appearance={project.appearance} size="sm" className="-ml-0.5" />
                <span className="truncate">{name}</span>
              </Link>
            </>
          )
        }
      </ProjectActions>
      {row.open ? (
        <ul className="mt-0.5 mb-1 ml-3.5 flex flex-col gap-px border-l border-foreground/15 pl-1.5">
          {row.decks.map((deck) => (
            <li key={deck.deckId}>
              <HistoryDeck deck={deck} onNavigate={onNavigate} />
            </li>
          ))}
          {row.decks.length === 0 && !searching ? (
            <li>
              <Link
                href={newDeckInProjectHref(project.projectId)}
                onClick={onNavigate}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground outline-none',
                  'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                )}
              >
                <PlusIcon size={14} />
                <span className="truncate">{t('newDeck')}</span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function HistoryDeck({ deck, onNavigate }: { deck: SidebarDeckRef; onNavigate?: () => void }) {
  const pathname = usePathname();
  const href = deckHref(deck.deckId);
  const active = pathname === href;
  return (
    <DeckActions
      deckId={deck.deckId}
      projectId={deck.projectId}
      title={deck.title}
      layout="sidebar"
    >
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        title={deck.title}
        onClick={onNavigate}
        className={cn(
          'flex h-8 min-w-0 items-center rounded-md pr-7 pl-2 text-sm outline-none',
          'transition-colors duration-100 motion-reduce:transition-none',
          'focus-visible:ring-2 focus-visible:ring-ring/50',
          active
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <span className="truncate">
          <DeckTitle>{deck.title}</DeckTitle>
        </span>
      </Link>
    </DeckActions>
  );
}

function DayLabel({ day, now }: { day: HistoryDay; now: number }) {
  const t = useTranslations('library');
  const format = useFormatter();
  if (day.kind === 'today') return t('today');
  if (day.kind === 'yesterday') return t('yesterday');
  const date = new Date(day.at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return format.dateTime(
    date,
    sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' },
  );
}

function NavRow({
  href,
  active,
  onNavigate,
  icon,
  className,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md px-2 text-sm outline-none',
        'transition-colors duration-100 motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** «⋯» в строке панели: без своей плашки, строка и так одна. */
const MENU_BUTTON =
  'top-1/2 right-0.5 size-6 -translate-y-1/2 bg-transparent shadow-none ring-0 backdrop-blur-none';
