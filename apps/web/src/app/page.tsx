import { Suspense } from 'react';
import { EditorShell } from '@/components/editor/editor-shell';
import { mediaUrls } from '@/lib/deck-source';
import { DEMO_DECK_ID } from '@/mocks/demo-deck';
import { createDemoDeckSource } from '@/mocks/demo-deck-source';

/**
 * Пока API нет, колоду отдаёт демо-источник. Дальше страница знает только `DeckSource`, а
 * редактор — только `Deck`: замена источника их не затронет.
 */
const deckSource = createDemoDeckSource();

export default async function HomePage() {
  const deck = await deckSource.getDeck(DEMO_DECK_ID);

  return (
    // Открытый слайд редактор читает из адреса через `useSearchParams`, а тому нужна граница.
    <Suspense>
      <EditorShell deck={deck} media={mediaUrls(deckSource, deck)} />
    </Suspense>
  );
}
