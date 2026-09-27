import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DeckChat } from '@/components/assistant/deck-chat';
import { librarySource } from '@/mocks/sources';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('deckChat'), getTranslations('metadata')]);
  return { title: t('documentTitle', { app: tMeta('title') }) };
}

/**
 * Разговор о новой колоде: агент собирает её здесь, а не в редакторе, и отдаёт готовый результат.
 * Страница в главном меню, рядом с проектами: разговор живёт во вкладке, поэтому сервер отдаёт
 * только шаблоны библиотеки — в любом из них ту же колоду можно собрать заново.
 */
export default async function DeckChatPage({ params }: { params: Promise<{ threadId: string }> }) {
  const [{ threadId }, templates] = await Promise.all([params, librarySource.listTemplates()]);
  return <DeckChat threadId={threadId} templates={templates} />;
}
