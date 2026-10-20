import { describe, expect, it } from 'vitest';
import { createDemoLibrary } from '../mocks/demo-library';
import { DEMO_DECK } from '../mocks/demo-deck';
import { recommendVariant, resultOfBuild, reviewDeck } from './variant-review';

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

  it('сравнивает известные аудиты, даже если у остальных вариантов их нет', () => {
    expect(
      recommendVariant(variants, {
        d: { errors: 0, warnings: 0 },
        b: { errors: 5, warnings: 0 },
      }),
    ).toBe('dense');
  });

  it('считает известный результат лучше неизвестного, не трактуя его как ноль', () => {
    const candidates = variants.filter(({ variant }) => variant !== 'airy');
    expect(recommendVariant(candidates, { d: { errors: 5, warnings: 0 } })).toBe('dense');
  });

  it('при одинаковом аудите советует сбалансированный', () => {
    expect(
      recommendVariant(variants, {
        d: { errors: 2, warnings: 1 },
        b: { errors: 2, warnings: 1 },
        a: { errors: 2, warnings: 1 },
      }),
    ).toBe('balanced');
  });
});

describe('resultOfBuild', () => {
  const variants = [
    { variant: 'dense' as const, deckId: 'd' },
    { variant: 'balanced' as const, deckId: 'b' },
    { variant: 'airy' as const, deckId: 'a' },
  ];
  const decks = variants.map(({ variant, deckId }) => ({ ...DEMO_DECK, deckId, variant }));
  const part = {
    type: 'result' as const,
    buildId: 'build',
    variants,
    reviews: {
      d: {
        errors: 1,
        warnings: 0,
        status: 'requires-review' as const,
        contentRevision: 1,
        contentHash: 'a'.repeat(64),
      },
      b: {
        errors: 2,
        warnings: 2,
        status: 'requires-review' as const,
        contentRevision: 1,
        contentHash: 'b'.repeat(64),
      },
      a: {
        errors: 3,
        warnings: 3,
        status: 'requires-review' as const,
        contentRevision: 1,
        contentHash: 'c'.repeat(64),
      },
    },
    recommended: 'dense' as const,
    elapsedMs: 325000,
  };

  it('does not present old counts without a verified revision as a complete audit', () => {
    const result = resultOfBuild(
      {
        ...part,
        reviews: {
          d: { errors: 0, warnings: 0 },
          b: { errors: 0, warnings: 0 },
          a: { errors: 0, warnings: 0 },
        },
      },
      decks,
    );
    expect(result.reviews).toBeNull();
    expect(result.recommended).toBe('balanced');
  });

  it('сохраняет проверенные аудиты доступных вариантов, если один аудит неизвестен', () => {
    const result = resultOfBuild(
      {
        ...part,
        reviews: {
          d: { ...part.reviews.d, errors: 0, warnings: 0 },
          b: { ...part.reviews.b, errors: 5, warnings: 0 },
        },
      },
      decks,
    );

    expect(result.reviews).toEqual({
      d: { ...part.reviews.d, errors: 0, warnings: 0 },
      b: { ...part.reviews.b, errors: 5, warnings: 0 },
    });
    expect(result.recommended).toBe('dense');
  });

  it('показывает сохранённый аудит сборки даже когда аудит импортированных слайдов другой', () => {
    const dense = decks[0];
    if (!dense) throw new Error('Dense fixture is missing');
    expect(reviewDeck(dense)).not.toEqual(part.reviews.d);
    const result = resultOfBuild(part, decks);
    expect(result.reviews).toEqual(part.reviews);
    expect(result.recommended).toBe('dense');
    expect(result.elapsedMs).toBe(325000);
    expect(result.variants.map(({ deckId }) => deckId)).toEqual(['d', 'b', 'a']);
  });

  it('показывает несобранный вариант, чтобы его можно было пересобрать', () => {
    const result = resultOfBuild(
      {
        ...part,
        variants: variants.slice(1),
        failed: [{ variant: 'dense', runId: 'run-x', status: 'failed', reason: 'HTTP 429' }],
      },
      decks,
    );
    expect(result.variants.map(({ variant }) => variant)).toEqual(['balanced', 'airy']);
    expect(result.failed).toEqual([{ variant: 'dense', status: 'failed', reason: 'HTTP 429' }]);
  });

  it('у сохранённого до пересборки итога несобранных нет', () => {
    expect(resultOfBuild(part, decks).failed).toEqual([]);
  });

  it('исправляет устаревший совет по показанным числам из скриншота', () => {
    const result = resultOfBuild(
      {
        ...part,
        reviews: {
          d: { ...part.reviews.d, errors: 13, warnings: 13 },
          b: { ...part.reviews.b, errors: 7, warnings: 7 },
          a: { ...part.reviews.a, errors: 4, warnings: 6 },
        },
      },
      decks,
    );
    expect(result.recommended).toBe('airy');
  });

  it('при недоступном аудите не подменяет его аудитом редактора', () => {
    const result = resultOfBuild({ ...part, reviews: null }, decks);
    expect(result.reviews).toBeNull();
    expect(result.recommended).toBe('balanced');
  });

  it('сопоставляет загруженные колоды по id, сохраняя порядок вариантов', () => {
    const result = resultOfBuild(part, [...decks].reverse());
    expect(result.variants.map(({ deckId, variant }) => ({ deckId, variant }))).toEqual(variants);
  });
});
