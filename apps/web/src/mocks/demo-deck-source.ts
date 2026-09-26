import { DeckNotFoundError, type Deck, type DeckSource } from '../lib/deck-source';
import { DEMO_DECK } from './demo-deck';

/** Колода по id из общего с библиотекой хранилища; нет такой — undefined. */
export type DeckLookup = (deckId: string) => Deck | undefined;

/**
 * Источник колод поверх демо-данных, без сети. Каждый вызов отдаёт свою копию колоды, как
 * отдал бы HTTP-ответ: правка полученного объекта не должна менять следующий ответ.
 *
 * Колоды — либо неизменный список, либо поиск по хранилищу демо-библиотеки: тогда
 * переименование и удаление из меню видны и редактору.
 */
export function createDemoDeckSource(
  decks: readonly Deck[] | DeckLookup = [DEMO_DECK],
): DeckSource {
  let find: DeckLookup;
  if (typeof decks === 'function') {
    find = decks;
  } else {
    const byId = new Map(decks.map((deck) => [deck.deckId, deck]));
    find = (deckId) => byId.get(deckId);
  }
  return {
    async getDeck(deckId) {
      const deck = find(deckId);
      if (!deck) throw new DeckNotFoundError(deckId);
      return structuredClone(deck);
    },
    // Картинок у демо-колоды нет: слайд нарисует на их месте рамку.
    mediaUrl: () => null,
  };
}
