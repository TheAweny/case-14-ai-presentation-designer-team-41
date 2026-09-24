import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { DeckEditor } from '@/components/editor/deck-editor';
import { EDITOR_LAYOUT_COOKIE, parseEditorLayout } from '@/components/editor/editor-layout';
import { mediaUrls } from '@/lib/deck-source';
import { DEMO_DECK_ID } from '@/mocks/demo-deck';
import { createDemoDeckSource } from '@/mocks/demo-deck-source';

/**
 * Пока API нет, колоду отдаёт демо-источник. Дальше страница знает только `DeckSource`, а
 * редактор — только `Deck`: замена источника их не затронет.
 */
const deckSource = createDemoDeckSource();

export default async function HomePage() {
  // Раскладку панелей читаем на сервере: колонки сразу той ширины, что человек настроил.
  const [deck, cookieStore] = await Promise.all([deckSource.getDeck(DEMO_DECK_ID), cookies()]);
  const layout = parseEditorLayout(cookieStore.get(EDITOR_LAYOUT_COOKIE)?.value);

  return (
    // Открытый слайд редактор читает из адреса через `useSearchParams`, а тому нужна граница.
    <Suspense>
      <DeckEditor deck={deck} media={mediaUrls(deckSource, deck)} layout={layout} />
    </Suspense>
  );
}
