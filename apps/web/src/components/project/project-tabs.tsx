'use client';

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TAB_PARAM } from '@/lib/library-menu';
import {
  DEFAULT_PROJECT_TAB,
  isProjectTab,
  parseProjectTab,
  replaceSearchParam,
} from './project-tab';

/**
 * Вкладки страницы проекта: презентации и шаблоны. Содержимое рисует сервер, здесь только
 * переключение. Выбранная вкладка живёт в `?tab=` и читается оттуда же: ссылкой можно
 * поделиться, а пункт меню «Прикрепить шаблон» открывает вкладку и на странице самого проекта.
 * Адрес меняется без перехода, поэтому переключение мгновенное.
 */
export function ProjectTabs({
  deckCount,
  templateCount,
  decks,
  templates,
}: {
  deckCount: number;
  templateCount: number;
  decks: ReactNode;
  templates: ReactNode;
}) {
  const t = useTranslations('projectPage.tabs');
  const tab = parseProjectTab(useSearchParams().get(TAB_PARAM));

  const change = (next: string) => {
    if (!isProjectTab(next)) return;
    replaceSearchParam(TAB_PARAM, next === DEFAULT_PROJECT_TAB ? null : next);
  };

  return (
    <Tabs value={tab} onValueChange={change} className="gap-5">
      <TabsList aria-label={t('label')} className="h-9">
        <TabsTrigger value="decks" className="h-8 px-3 text-sm">
          {t('decks')}
          <Count value={deckCount} />
        </TabsTrigger>
        <TabsTrigger value="templates" className="h-8 px-3 text-sm">
          {t('templates')}
          <Count value={templateCount} />
        </TabsTrigger>
      </TabsList>
      <TabsContent value="decks" className="min-w-0">
        {decks}
      </TabsContent>
      <TabsContent value="templates" className="min-w-0">
        {templates}
      </TabsContent>
    </Tabs>
  );
}

function Count({ value }: { value: number }) {
  return value > 0 ? (
    <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
  ) : null;
}
