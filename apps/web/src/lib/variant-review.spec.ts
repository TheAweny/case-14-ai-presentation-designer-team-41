import { describe, expect, it } from 'vitest';
import { createDemoLibrary } from '../mocks/demo-library';
import type { GeneratedVariant } from './deck-generator';
import { createVariantReview } from './variant-review';

describe('createVariantReview', () => {
  it('считает ошибки и замечания аудита по колоде каждого варианта', async () => {
    const { library, decks } = createDemoLibrary();
    const [first, second] = await library.listDecks();
    if (!first || !second) throw new Error('Demo library needs two decks');
    const variants = [
      { variant: 'dense', deckId: first.deckId },
      { variant: 'balanced', deckId: second.deckId },
    ] as GeneratedVariant[];

    const reviews = await createVariantReview(decks)(variants);

    expect(Object.keys(reviews).sort()).toEqual([first.deckId, second.deckId].sort());
    for (const review of Object.values(reviews)) {
      expect(review.errors).toBeGreaterThanOrEqual(0);
      expect(review.warnings).toBeGreaterThanOrEqual(0);
    }
  });

  it('колоды нет — аудит отказывает, и агент советует без него', async () => {
    const { decks } = createDemoLibrary();
    const review = createVariantReview(decks);
    await expect(
      review([{ variant: 'airy', deckId: 'missing' } as GeneratedVariant]),
    ).rejects.toThrow();
  });
});
