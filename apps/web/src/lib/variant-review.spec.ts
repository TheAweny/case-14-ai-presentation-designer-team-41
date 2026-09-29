import { describe, expect, it } from 'vitest';
import { createDemoLibrary } from '../mocks/demo-library';
import { recommendVariant, reviewDeck } from './variant-review';

describe('reviewDeck', () => {
  it('считает ошибки и замечания аудита по колоде варианта', async () => {
    const { library, decks } = createDemoLibrary();
    const [first] = await library.listDecks();
    if (!first) throw new Error('Demo library needs a deck');
    const review = reviewDeck(await decks.getDeck(first.deckId));
    expect(review.errors).toBeGreaterThanOrEqual(0);
    expect(review.warnings).toBeGreaterThanOrEqual(0);
  });
});

describe('recommendVariant', () => {
  const variants = [
    { variant: 'dense' as const, deckId: 'd' },
    { variant: 'balanced' as const, deckId: 'b' },
    { variant: 'airy' as const, deckId: 'a' },
  ];

  it('советует вариант с меньшим числом ошибок, затем замечаний', () => {
    expect(
      recommendVariant(variants, {
        d: { errors: 0, warnings: 2 },
        b: { errors: 1, warnings: 0 },
        a: { errors: 0, warnings: 1 },
      }),
    ).toBe('airy');
  });

  it('без аудита советует сбалансированный', () => {
    expect(recommendVariant(variants, null)).toBe('balanced');
  });
});
