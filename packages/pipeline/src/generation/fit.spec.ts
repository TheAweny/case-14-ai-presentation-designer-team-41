import { describe, expect, it } from 'vitest';
import { shortened } from './fit.js';

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
