import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DeckChat } from '@/components/assistant/deck-chat';
import { librarySource } from '@/mocks/sources';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([getTranslations('deckChat'), getTranslations('metadata')]);
  return { title: t('documentTitle', { app: tMeta('title') }) };
}

/**
 * Чат с ассистентом: агент собирает колоду здесь, а не в редакторе, и отдаёт готовый результат.
 * Страница в главном меню, рядом с проектами; из истории в боковой панели открывается она. Сам
 * разговор вкладка берёт из API, сервер отдаёт шаблоны библиотеки — в любом из них ту же колоду
 * можно собрать заново.
 */
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const [{ chatId }, templates] = await Promise.all([params, librarySource.listTemplates()]);
  return <DeckChat threadId={chatId} templates={templates} />;
}
