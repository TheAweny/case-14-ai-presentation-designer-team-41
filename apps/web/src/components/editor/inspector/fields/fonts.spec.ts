import { describe, expect, it } from 'vitest';
import {
  COMMON_FONTS,
  buildFontRows,
  filterFamilies,
  fontFamilyCss,
  nextFontIndex,
  uniqueFamilies,
} from './fonts';

describe('uniqueFamilies', () => {
  it('убирает повторы начертаний и пустые строки, сортирует', () => {
    expect(uniqueFamilies(['Roboto', 'Arial', 'arial', ' Arial ', '', 'Roboto', 'Inter'])).toEqual([
      'Arial',
      'Inter',
      'Roboto',
    ]);
  });

  it('сортирует числа по-человечески', () => {
    expect(uniqueFamilies(['Source Sans 10', 'Source Sans 3'])).toEqual([
      'Source Sans 3',
      'Source Sans 10',
    ]);
  });

  it('запасной список уже без повторов и отсортирован', () => {
    expect(uniqueFamilies(COMMON_FONTS)).toEqual([...COMMON_FONTS]);
  });
});

describe('filterFamilies', () => {
  const fonts = ['Arial', 'Georgia', 'Noto Sans', 'PT Sans', 'Sans Forgetica'];

  it('сначала начало названия, потом вхождение', () => {
    expect(filterFamilies(fonts, 'sans')).toEqual(['Sans Forgetica', 'Noto Sans', 'PT Sans']);
  });

  it('без учёта регистра и пробелов по краям', () => {
    expect(filterFamilies(fonts, '  GEO ')).toEqual(['Georgia']);
  });

  it('пустой запрос — весь список', () => {
    expect(filterFamilies(fonts, '')).toEqual(fonts);
  });
});

describe('buildFontRows', () => {
  it('шрифты шаблона сверху и не повторяются во «Всех»', () => {
    const rows = buildFontRows(['Inter', 'Inter'], ['Arial', 'inter', 'Roboto'], '');
    expect(rows).toEqual([
      { kind: 'header', group: 'template' },
      { kind: 'font', family: 'Inter', group: 'template' },
      { kind: 'header', group: 'all' },
      { kind: 'font', family: 'Arial', group: 'all' },
      { kind: 'font', family: 'Roboto', group: 'all' },
    ]);
  });

  it('пустая после поиска группа исчезает вместе с заголовком', () => {
    expect(buildFontRows(['Inter'], ['Arial', 'Roboto'], 'rob')).toEqual([
      { kind: 'header', group: 'all' },
      { kind: 'font', family: 'Roboto', group: 'all' },
    ]);
    expect(buildFontRows(['Inter'], ['Arial'], 'zzz')).toEqual([]);
  });

  it('тысячи начертаний сводятся к семействам быстро', () => {
    const many = Array.from({ length: 20000 }, (_, index) => `Family ${index % 2000}`);
    const started = performance.now();
    const rows = buildFontRows([], many, 'family 1');
    expect(performance.now() - started).toBeLessThan(500);
    expect(rows.filter((row) => row.kind === 'font')).toHaveLength(1111);
  });
});

describe('nextFontIndex', () => {
  const rows = buildFontRows(['Inter'], ['Arial', 'Roboto'], '');

  it('перескакивает заголовки', () => {
    expect(nextFontIndex(rows, -1, 1)).toBe(1);
    expect(nextFontIndex(rows, 1, 1)).toBe(3);
    expect(nextFontIndex(rows, 3, -1)).toBe(1);
  });

  it('останавливается на краях', () => {
    expect(nextFontIndex(rows, 4, 1)).toBe(4);
    expect(nextFontIndex(rows, 1, -1)).toBe(1);
    expect(nextFontIndex(rows, -1, -1)).toBe(4);
    expect(nextFontIndex([], -1, 1)).toBe(-1);
  });
});

describe('fontFamilyCss', () => {
  it('берёт имя в кавычки и не пропускает кавычки из имени', () => {
    expect(fontFamilyCss('PT Sans')).toBe('"PT Sans", system-ui, sans-serif');
    expect(fontFamilyCss('Bad"Name')).toBe('"BadName", system-ui, sans-serif');
  });
});
