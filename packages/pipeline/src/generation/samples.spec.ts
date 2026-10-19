import { describe, expect, it } from 'vitest';
import { briefStates, isFigureSample, leakedSamples } from './samples.js';

// The same examples as engine/tests/test_sample_figures.py: the two layers must agree.
describe('isFigureSample', () => {
  it('strips punctuation at both ends consistently across repeated calls', () => {
    for (let pass = 0; pass < 3; pass++) {
      expect(isFigureSample('(III) (кв.)')).toBe(true);
      expect(isFigureSample('(млн.)')).toBe(false);
      expect(isFigureSample('(Иван) (Петров.)')).toBe(false);
    }
  });

  it.each(['05', '2,4%', 'III кв.', 'Q3', '70 млн', '2025', 'Июл', '22 300', '01.', '$1.2B'])(
    'takes %s for a figure or a period label',
    (sample) => {
      expect(isFigureSample(sample)).toBe(true);
    },
  );

  it.each(['', 'Фокус на удержание', 'Шаг 1', 'Возможности и риски', 'млн', 'кв.', 'Иван Петров'])(
    'takes %j for words or a bare unit',
    (sample) => {
      expect(isFigureSample(sample)).toBe(false);
    },
  );
});

describe('briefStates', () => {
  it('finds a sample as a whole token, not as a part of a number or a word', () => {
    expect(briefStates('Рост за III кв. составил 12%', 'III кв.')).toBe(true);
    expect(briefStates('Выручка 105 млн', '05')).toBe(false);
    expect(briefStates('Выручка за 2025 год', '2025')).toBe(true);
    expect(briefStates('Выручка за 20255 год', '2025')).toBe(false);
  });
});

const composition = {
  slots: [
    { slotId: 'title', role: 'title', sample: 'Динамика выручки' },
    { slotId: 'badge', role: 'body', sample: '05' },
    { slotId: 'arrow', role: 'body', sample: '2025' },
    { slotId: 'quarter', role: 'body', sample: 'III кв.' },
    { slotId: 'point', role: 'body', sample: 'Фокус на удержание' },
  ],
};

const slide = (texts: Record<string, string>) => ({
  index: 2,
  composition,
  slide: { texts: Object.entries(texts).map(([slotId, text]) => ({ slotId, text })) },
});

describe('leakedSamples', () => {
  it('finds the figures and period labels the writer kept from the template', () => {
    const kept = slide({
      title: 'Динамика выручки',
      badge: '05',
      arrow: '2025',
      quarter: ' III  кв. ',
      point: 'Фокус на удержание',
    });
    const leaked = leakedSamples([kept], 'Выручка выросла: 42, 47, 55 млн');
    expect(leaked.map((l) => l.slotId)).toEqual(['badge', 'arrow', 'quarter']);
    expect(leaked[0]).toMatchObject({ index: 2, sample: '05' });
  });

  it('leaves what the writer wrote, a sample the brief states, a title and a sample of words', () => {
    const written = slide({
      title: '05',
      badge: '12',
      arrow: '2025',
      quarter: 'Итоги',
      point: 'Фокус на удержание',
    });
    expect(leakedSamples([written], 'План на 2025 год: выручка 12 млн')).toEqual([]);
  });
});
