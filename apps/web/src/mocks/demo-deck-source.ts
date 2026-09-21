import { DeckNotFoundError, type Deck, type DeckSource } from '../lib/deck-source';
import { DEMO_DECK } from './demo-deck';

/**
 * Источник колод поверх демо-данных, без сети. Каждый вызов отдаёт свою копию колоды, как
 * отдал бы HTTP-ответ: правка полученного объекта не должна менять следующий ответ.
 */
export function createDemoDeckSource(decks: readonly Deck[] = [DEMO_DECK]): DeckSource {
  const byId = new Map(decks.map((deck) => [deck.deckId, deck]));
  return {
    async getDeck(deckId) {
      const deck = byId.get(deckId);
      if (!deck) throw new DeckNotFoundError(deckId);
      return structuredClone(deck);
    },
    // Картинок у демо-колоды нет: слайд нарисует на их месте рамку.
    mediaUrl: () => null,
  };
}
