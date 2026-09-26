import { describe, expect, it } from 'vitest';
import { textWidthEmu } from '../schematic/text-layout.js';
import { wrapLabel } from './chart-labels.js';

const SIZE = 10;

describe('wrapLabel', () => {
  it('keeps a label that fits on one line', () => {
    expect(wrapLabel('Экспорт', 200, SIZE)).toEqual(['Экспорт']);
  });

  it('wraps by words into two lines that each fit', () => {
    const width = textWidthEmu('Вёрстка трёх', SIZE) + 1;
    const lines = wrapLabel('Вёрстка трёх вариантов', width, SIZE);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(textWidthEmu(line, SIZE)).toBeLessThanOrEqual(width);
    expect(lines[0]).toBe('Вёрстка трёх');
  });

  it('ends an overlong label with an ellipsis instead of spilling', () => {
    const width = textWidthEmu('Очень длинное', SIZE);
    const lines = wrapLabel('Очень длинное название категории графика', width, SIZE);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
    for (const line of lines) expect(textWidthEmu(line, SIZE)).toBeLessThanOrEqual(width);
  });

  it('gives nothing for an empty label', () => {
    expect(wrapLabel('  ', 100, SIZE)).toEqual([]);
  });
});
