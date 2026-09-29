import { describe, expect, it } from 'vitest';
import { DEMO_DECK } from '../mocks/demo-deck';
import { loadResultVariants } from './load-result-variants';

const variants = [
  { variant: 'dense' as const, deckId: 'd' },
  { variant: 'balanced' as const, deckId: 'b' },
  { variant: 'airy' as const, deckId: 'a' },
];
const part = {
  type: 'result' as const,
  buildId: 'build',
  variants,
  recommended: 'balanced' as const,
  elapsedMs: 43000,
  reviews: null,
};

describe('loadResultVariants', () => {
  it('loads all previews concurrently and preserves their variant order', async () => {
    const requested: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = loadResultVariants(part, async (deckId) => {
      requested.push(deckId);
      await gate;
      return { ...DEMO_DECK, deckId };
    });
    expect(requested).toEqual(['d', 'b', 'a']);
    release();
    const loaded = await pending;
    expect(loaded.failedCount).toBe(0);
    expect(loaded.result.variants.map(({ deckId }) => deckId)).toEqual(['d', 'b', 'a']);
  });

  it('keeps completed variants visible when one preview times out', async () => {
    const loaded = await loadResultVariants(part, async (deckId) => {
      if (deckId === 'b') throw new DOMException('Timed out', 'TimeoutError');
      return { ...DEMO_DECK, deckId };
    });
    expect(loaded.failedCount).toBe(1);
    expect(loaded.result.variants.map(({ deckId }) => deckId)).toEqual(['d', 'a']);
    expect(loaded.result.recommended).toBe('dense');
  });

  it('ends loading with an error when all previews fail and can retry', async () => {
    await expect(
      loadResultVariants(part, async () => {
        throw new Error('Unavailable');
      }),
    ).rejects.toThrow('No result variants');
    const retried = await loadResultVariants(part, async (deckId) => ({ ...DEMO_DECK, deckId }));
    expect(retried.failedCount).toBe(0);
  });
});
