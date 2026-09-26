import { describe, expect, it } from 'vitest';
import type { ChartData } from './chart-data';
import {
  chartDataFromRows,
  isRange,
  parseDelimited,
  parseLocaleNumber,
  pasteRows,
  type ChartNames,
} from './chart-paste';

const names: ChartNames = {
  series: (n) => `Ряд ${n}`,
  category: (n) => `Категория ${n}`,
};

describe('parseDelimited', () => {
  it('reads a range copied from Excel or Sheets, with the trailing line break', () => {
    expect(parseDelimited('\tВыручка\tРасходы\r\n2024\t10\t7\r\n2025\t12\t8\r\n')).toEqual([
      ['', 'Выручка', 'Расходы'],
      ['2024', '10', '7'],
      ['2025', '12', '8'],
    ]);
  });

  it('reads CSV with semicolons, commas and quoted cells', () => {
    expect(parseDelimited('Год;Выручка\n2024;"1 234,5"\n')).toEqual([
      ['Год', 'Выручка'],
      ['2024', '1 234,5'],
    ]);
    expect(parseDelimited('a,"b, ""c""",d\n"line\nbreak",1,2')).toEqual([
      ['a', 'b, "c"', 'd'],
      ['line\nbreak', '1', '2'],
    ]);
  });

  it('tells a range from a single value', () => {
    expect(isRange('12,5')).toBe(false);
    expect(isRange('12,5\r\n')).toBe(false);
    expect(isRange('1\t2')).toBe(true);
    expect(isRange('1\n2')).toBe(true);
  });
});

describe('parseLocaleNumber', () => {
  it('reads numbers as spreadsheets in Russian and English write them', () => {
    expect(parseLocaleNumber('1 234,5')).toBe(1234.5);
    expect(parseLocaleNumber('1\u00a0234\u00a0567')).toBe(1_234_567);
    expect(parseLocaleNumber('1\u202f234,25')).toBe(1234.25);
    expect(parseLocaleNumber('1.234,5')).toBe(1234.5);
    expect(parseLocaleNumber('1,234.5')).toBe(1234.5);
    expect(parseLocaleNumber('1,234,567')).toBe(1_234_567);
    expect(parseLocaleNumber('1.234.567')).toBe(1_234_567);
    expect(parseLocaleNumber('0,75')).toBe(0.75);
    expect(parseLocaleNumber('−7')).toBe(-7);
    expect(parseLocaleNumber('-7,5')).toBe(-7.5);
    expect(parseLocaleNumber('(300)')).toBe(-300);
    expect(parseLocaleNumber('12 %')).toBe(12);
    expect(parseLocaleNumber('₽ 300')).toBe(300);
    expect(parseLocaleNumber('$1,200.00')).toBe(1200);
  });

  it('refuses what is not a number', () => {
    for (const text of ['', ' ', 'Выручка', '12a4', '-', '1,2,3.4.5', '2024-01-01']) {
      expect(parseLocaleNumber(text)).toBeNull();
    }
  });
});

describe('chartDataFromRows', () => {
  it('takes series from the first row and categories from the first column', () => {
    const rows = parseDelimited('\tВыручка\tРасходы\n2024\t1 200,5\t700\n2025\t1 500\t800\n');
    expect(chartDataFromRows(rows, names)).toEqual({
      categories: ['2024', '2025'],
      series: [
        { name: 'Выручка', values: [1200.5, 1500] },
        { name: 'Расходы', values: [700, 800] },
      ],
    });
  });

  it('keeps years as series names when the corner is empty', () => {
    const rows = parseDelimited('\t2024\t2025\nQ1\t10\t12\nQ2\t11\t14');
    expect(chartDataFromRows(rows, names)).toEqual({
      categories: ['Q1', 'Q2'],
      series: [
        { name: '2024', values: [10, 11] },
        { name: '2025', values: [12, 14] },
      ],
    });
  });

  it('reads a column of years under a title as categories, and other numbers as a series', () => {
    expect(chartDataFromRows(parseDelimited('Год;Выручка\n2024;10\n2025;12'), names)).toEqual({
      categories: ['2024', '2025'],
      series: [{ name: 'Выручка', values: [10, 12] }],
    });
    expect(chartDataFromRows(parseDelimited('План\tФакт\n10\t9\n12\t13'), names)).toEqual({
      categories: ['Категория 1', 'Категория 2'],
      series: [
        { name: 'План', values: [10, 12] },
        { name: 'Факт', values: [9, 13] },
      ],
    });
  });

  it('names what the range does not: bare numbers, or a column with a title only', () => {
    expect(chartDataFromRows(parseDelimited('1\t2\n3\t4'), names)).toEqual({
      categories: ['Категория 1', 'Категория 2'],
      series: [
        { name: 'Ряд 1', values: [1, 3] },
        { name: 'Ряд 2', values: [2, 4] },
      ],
    });
    expect(chartDataFromRows(parseDelimited('Выручка\n10\n12'), names)).toEqual({
      categories: ['Категория 1', 'Категория 2'],
      series: [{ name: 'Выручка', values: [10, 12] }],
    });
  });

  it('reads empty or unreadable values as zero, and refuses a range with no number', () => {
    expect(chartDataFromRows(parseDelimited('\tA\nx\t\ny\tn/a\nz\t5'), names)?.series).toEqual([
      { name: 'A', values: [0, 0, 5] },
    ]);
    expect(chartDataFromRows(parseDelimited('Просто текст\nещё текст'), names)).toBeNull();
    expect(chartDataFromRows([], names)).toBeNull();
  });
});

describe('pasteRows', () => {
  const data: ChartData = {
    categories: ['2024', '2025'],
    series: [
      { name: 'Выручка', values: [10, 12] },
      { name: 'Расходы', values: [7, 8] },
    ],
  };

  it('spreads a range right and down from the cell it was pasted into', () => {
    expect(pasteRows(data, [['20', '9']], { row: 2, column: 1 }, names)).toEqual({
      categories: ['2024', '2025'],
      series: [
        { name: 'Выручка', values: [10, 20] },
        { name: 'Расходы', values: [7, 9] },
      ],
    });
    expect(data.series[0]?.values).toEqual([10, 12]);
  });

  it('grows categories and series the range reaches past', () => {
    const next = pasteRows(
      data,
      [
        ['2026', '1 000', '3', '4'],
        ['2027', '5', '6', '7'],
      ],
      { row: 3, column: 0 },
      names,
    );
    expect(next.categories).toEqual(['2024', '2025', '2026', '2027']);
    expect(next.series).toEqual([
      { name: 'Выручка', values: [10, 12, 1000, 5] },
      { name: 'Расходы', values: [7, 8, 3, 6] },
      { name: 'Ряд 3', values: [0, 0, 4, 7] },
    ]);
  });

  it('renames series from the header row and keeps values it cannot read', () => {
    const next = pasteRows(
      data,
      [
        ['Доход', 'Затраты'],
        ['x', '1'],
      ],
      { row: 0, column: 1 },
      names,
    );
    expect(next.series).toEqual([
      { name: 'Доход', values: [10, 12] },
      { name: 'Затраты', values: [1, 8] },
    ]);
  });
});
