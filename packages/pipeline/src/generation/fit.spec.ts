import { describe, expect, it } from 'vitest';
import { longestWord, shortened, tearsAWord } from './fit.js';
import { bestFittingAlternative } from './workflow.js';

describe('shortened', () => {
  it('drops the lines past the limit first', () => {
    const text = 'Датчики в подъездах\nДанные в диспетчерской\nОтчёт для жителей';
    expect(shortened(text, { lines: 3, maxLines: 2, maxChars: 80 })).toBe(
      'Датчики в подъездах\nДанные в диспетчерской',
    );
  });

  it('cuts one line at a word, never mid-word, without a dangling dash', () => {
    const cut = shortened('Сбор данных — в реальном времени', {
      lines: 3,
      maxLines: 2,
      maxChars: 17,
    });
    expect(cut.length).toBeLessThanOrEqual(17);
    expect('Сбор данных — в реальном времени'.startsWith(cut)).toBe(true);
    expect(cut).not.toMatch(/[—\s]$/);
  });

  it('cuts a single word as the very last resort', () => {
    const cut = shortened('Датчики', { lines: 2, maxLines: 1, maxChars: 4 });
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.length).toBeLessThanOrEqual(4);
  });
});

describe('a word wider than the text box', () => {
  // 24 pt in a 270 pt box: a character is taken as 0.6 of the size, so 18 of them fit a line.
  const slot = { fontSize: 24, textWidthPt: 270 };

  it('measures the longest word without the punctuation hanging on it', () => {
    expect(longestWord('Возможности, риски и «выводы».')).toBe(11);
    expect(longestWord('')).toBe(0);
  });

  it('is told from text that wraps between words', () => {
    expect(tearsAWord('Достопримечательностей и риски', slot)).toBe(true);
    expect(tearsAWord('Возможности и риски роста', slot)).toBe(false);
  });

  it('claims nothing when the slot has no width', () => {
    expect(tearsAWord('Достопримечательностей', { fontSize: 24 })).toBe(false);
  });

  it('is left out of the alternatives while another fits whole', () => {
    const wide = {
      role: 'title',
      sample: 'Пример заголовка слайда',
      maxChars: 60,
      maxLines: 2,
      ...slot,
    };
    const torn = 'Достопримечательностей и риски';
    const whole = 'Возможности и риски';
    // The longer one would be taken for fitting better, but it would be torn.
    expect(bestFittingAlternative(wide, [torn, whole])).toBe(whole);
    // With nothing else to take, it is still answered with.
    expect(bestFittingAlternative(wide, [torn])).toBe(torn);
    // A slot that does not tell its width keeps the old choice: the longest that fits.
    const { fontSize: _size, textWidthPt: _width, ...unmeasured } = wide;
    expect(bestFittingAlternative(unmeasured, [torn, whole])).toBe(torn);
  });
});
