import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DeckEditor } from '@/components/editor/deck-editor';
import { EDITOR_LAYOUT_COOKIE, parseEditorLayout } from '@/components/editor/editor-layout';
import { DeckNotFoundError, mediaUrls } from '@/lib/deck-source';
import { isPresentRequested, PRESENT_PARAM } from '@/lib/library-menu';
import { deckSource, librarySource } from '@/mocks/sources';

/**
 * Страница знает только `DeckSource`, а редактор — только `Deck`: замена источника их не затронет.
 * С `?present=1` (пункт «Начать показ» в меню презентации) колода открывается сразу в показе.
 */
export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ deckId }, query] = await Promise.all([params, searchParams]);
  // Раскладку панелей читаем на сервере: колонки сразу той ширины, что человек настроил.
  const [deck, cookieStore, templates] = await Promise.all([
    deckSource.getDeck(deckId).catch((error: unknown) => {
      if (error instanceof DeckNotFoundError) notFound();
      throw error;
    }),
    cookies(),
    // Шаблоны — для плана в чате колоды; без них чат работает, только план не собрать.
    librarySource.listTemplates().catch(() => []),
  ]);
  const layout = parseEditorLayout(cookieStore.get(EDITOR_LAYOUT_COOKIE)?.value);

  return (
    // Открытый слайд редактор читает из адреса через `useSearchParams`, а тому нужна граница.
    <Suspense>
      <DeckEditor
        deck={deck}
        media={mediaUrls(deckSource, deck)}
        layout={layout}
        present={isPresentRequested(query[PRESENT_PARAM])}
        templates={templates}
      />
    </Suspense>
  );
}
