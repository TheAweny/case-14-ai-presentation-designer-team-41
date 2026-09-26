import { describe, expect, it } from 'vitest';
import { filterDecks, isDeckSort, searchKey, sortDecks } from './deck-browse';

const decks = [
  { id: 'a', title: 'Итоги квартала', updatedAt: 50 },
  { id: 'b', title: 'Спринт 10', updatedAt: 100 },
  { id: 'c', title: 'Ещё один питч', updatedAt: 500 },
  { id: 'd', title: 'Спринт 2', updatedAt: 100 },
  { id: 'e', title: 'предложение клиенту', updatedAt: 200 },
];

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('searchKey', () => {
  it('без регистра, «ё» как «е», пробелы схлопнуты', () => {
    expect(searchKey('  ЕЩЁ   Один ', 'ru')).toBe('еще один');
  });
});

describe('filterDecks', () => {
  it('пустой запрос и одни пробелы ничего не отсеивают', () => {
    expect(filterDecks(decks, '')).toBe(decks);
    expect(filterDecks(decks, '   ')).toBe(decks);
  });

  it('ищет подстроку в названии без учёта регистра', () => {
    expect(ids(filterDecks(decks, 'СПРИНТ', 'ru'))).toEqual(['b', 'd']);
    expect(ids(filterDecks(decks, 'клиент', 'ru'))).toEqual(['e']);
  });

  it('«е» находит «ё» и наоборот', () => {
    expect(ids(filterDecks(decks, 'еще', 'ru'))).toEqual(['c']);
    expect(ids(filterDecks(decks, 'ещё', 'ru'))).toEqual(['c']);
  });

  it('лишние пробелы в запросе не мешают', () => {
    expect(ids(filterDecks(decks, '  итоги   квартала ', 'ru'))).toEqual(['a']);
  });

  it('нет совпадений — пустой список', () => {
    expect(filterDecks(decks, 'бюджет', 'ru')).toEqual([]);
  });
});

describe('sortDecks', () => {
  it('недавние — свежие первыми, при равном времени по названию', () => {
    expect(ids(sortDecks(decks, 'recent', 'ru'))).toEqual(['c', 'e', 'd', 'b', 'a']);
  });

  it('по названию — по алфавиту без учёта регистра, числа как числа', () => {
    expect(ids(sortDecks(decks, 'title', 'ru'))).toEqual(['c', 'a', 'e', 'd', 'b']);
  });

  it('при равных названиях свежие первыми', () => {
    const twins = [
      { id: 'old', title: 'План', updatedAt: 1 },
      { id: 'new', title: 'план', updatedAt: 2 },
    ];
    expect(ids(sortDecks(twins, 'title', 'ru'))).toEqual(['new', 'old']);
  });

  it('не меняет исходный массив', () => {
    const before = ids(decks);
    sortDecks(decks, 'title', 'ru');
    expect(ids(decks)).toEqual(before);
  });
});

describe('isDeckSort', () => {
  it('узнаёт только свои сортировки', () => {
    expect(isDeckSort('recent')).toBe(true);
    expect(isDeckSort('title')).toBe(true);
    expect(isDeckSort('size')).toBe(false);
    expect(isDeckSort(undefined)).toBe(false);
  });
});
