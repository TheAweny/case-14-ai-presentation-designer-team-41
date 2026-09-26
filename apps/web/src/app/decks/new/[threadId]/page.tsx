import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NewDeckEditor } from '@/components/assistant/new-deck-editor';
import { librarySource } from '@/mocks/sources';

export async function generateMetadata(): Promise<Metadata> {
  const [t, tMeta] = await Promise.all([
    getTranslations('newDeckEditor'),
    getTranslations('metadata'),
  ]);
  return { title: t('documentTitle', { app: tMeta('title') }) };
}

/**
 * Новая колода, пока агент её собирает. Разговор живёт во вкладке, поэтому сервер отдаёт только
 * проекты — по ним окно светится цветом проекта, — а остальное рисует клиент.
 */
export default async function NewDeckPage({ params }: { params: Promise<{ threadId: string }> }) {
  const [{ threadId }, projects] = await Promise.all([params, librarySource.listProjects()]);
  return <NewDeckEditor threadId={threadId} projects={projects} />;
}
