import type { ChatPart } from '@lct/contracts';
import type { Deck } from './deck-source';
import { resultOfBuild, type DeckResult } from './variant-review';

/** A failed preview does not hide the other completed variants. */
export async function loadResultVariants(
  part: Extract<ChatPart, { type: 'result' }>,
  load: (deckId: string) => Promise<Deck>,
): Promise<{ readonly result: DeckResult; readonly failedCount: number }> {
  const settled = await Promise.allSettled(part.variants.map(({ deckId }) => load(deckId)));
  const decks = settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
  const result = resultOfBuild(part, decks);
  if (result.variants.length === 0) throw new Error('No result variants could be loaded');
  return { result, failedCount: part.variants.length - result.variants.length };
}
