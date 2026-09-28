'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CloseIcon, GridIcon, ListIcon, SearchIcon, SortIcon } from '@/components/ui/icons';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { CardGrid, EmptyState, HIDE_REMOVED_ITEMS } from '@/components/library/page-parts';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DECK_SORTS,
  filterDecks,
  isDeckSort,
  sortDecks,
  type BrowsableDeck,
  type DeckSort,
} from '@/lib/deck-browse';
import { cn } from '@/lib/utils';

/**
 * Презентация в списке проекта. Карточку и строку рисует сервер — там же считается «2 часа
 * назад», — а здесь их только отбирают и расставляют.
 */
export interface DeckBrowserItem extends BrowsableDeck {
  readonly deckId: string;
  readonly card: ReactNode;
  readonly row: ReactNode;
}

const VIEWS = ['grid', 'list'] as const;
type DeckView = (typeof VIEWS)[number];

/**
 * Презентации проекта: поиск по названию, сортировка и вид сеткой или списком. Пустой проект
 * показывает `empty` без панели — искать там нечего.
 */
export function DeckBrowser({
  items,
  empty,
}: {
  items: readonly DeckBrowserItem[];
  empty: ReactNode;
}) {
  const t = useTranslations('projectPage.browser');
  const tTabs = useTranslations('projectPage.tabs');
  const locale = useLocale();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DeckSort>('recent');
  const [view, setView] = useState<DeckView>('grid');

  const shown = useMemo(
    () => sortDecks(filterDecks(items, query, locale), sort, locale),
    [items, query, sort, locale],
  );

  if (items.length === 0) return empty;

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок для навигации по заголовкам: карточки ниже — h3. */}
      <h2 className="sr-only">{tTabs('decks')}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div role="search" className="relative min-w-0 flex-1 basis-56">
          <label htmlFor={searchId} className="sr-only">
            {t('search')}
          </label>
          <SearchIcon
            size={16}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') {
                event.preventDefault();
                setQuery('');
              }
            }}
            className={cn(
              'h-8 w-full rounded-md bg-muted/60 pr-8 pl-8 text-sm text-foreground outline-none',
              'ring-1 ring-transparent placeholder:text-muted-foreground',
              'focus:bg-background focus:ring-ring [&::-webkit-search-cancel-button]:hidden',
            )}
          />
          {query !== '' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('clearSearch')}
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <CloseIcon />
            </Button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                aria-label={t('sort', { order: t(`sorts.${sort}`) })}
              >
                <SortIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">{t(`sorts.${sort}`)}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>{t('sortLabel')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(next) => {
                  if (isDeckSort(next)) setSort(next);
                }}
              >
                {DECK_SORTS.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {t(`sorts.${option}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroupPrimitive.Root
            type="single"
            aria-label={t('view')}
            value={view}
            onValueChange={(next) => {
              // Radix снимает выбор повторным щелчком, а вид нужен всегда.
              if (next === 'grid' || next === 'list') setView(next);
            }}
            className="flex h-8 items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
          >
            {VIEWS.map((option) => (
              <ToggleGroupPrimitive.Item
                key={option}
                value={option}
                aria-label={t(`views.${option}`)}
                title={t(`views.${option}`)}
                className={cn(
                  'grid h-full w-8 place-items-center rounded-[5px] text-muted-foreground outline-none',
                  'transition-colors duration-100 motion-reduce:transition-none',
                  'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                  'data-[state=on]:bg-foreground/15 data-[state=on]:text-foreground',
                )}
              >
                {option === 'grid' ? <GridIcon size={16} /> : <ListIcon size={16} />}
              </ToggleGroupPrimitive.Item>
            ))}
          </ToggleGroupPrimitive.Root>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title={t('noResults.title')}
          action={
            <Button variant="outline" onClick={() => setQuery('')}>
              {t('noResults.reset')}
            </Button>
          }
        >
          {t('noResults.body', { query: query.trim() })}
        </EmptyState>
      ) : view === 'grid' ? (
        <CardGrid>
          {shown.map((item) => (
            <li key={item.deckId} className="min-w-0">
              {item.card}
            </li>
          ))}
        </CardGrid>
      ) : (
        <ul
          className={cn(
            'flex flex-col divide-y divide-border overflow-hidden rounded-lg ring-1 ring-border',
            HIDE_REMOVED_ITEMS,
          )}
        >
          {shown.map((item) => (
            <li key={item.deckId} className="min-w-0">
              {item.row}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
