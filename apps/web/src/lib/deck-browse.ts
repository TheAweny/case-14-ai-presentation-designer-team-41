/**
 * Поиск и сортировка презентаций в списке проекта. Чистые функции: список на странице ими
 * только пользуется, а правила проверяются тестом без рендера.
 */

export const DECK_SORTS = ['recent', 'title'] as const;
export type DeckSort = (typeof DECK_SORTS)[number];

export function isDeckSort(value: unknown): value is DeckSort {
  return typeof value === 'string' && (DECK_SORTS as readonly string[]).includes(value);
}

/** Что функциям нужно о презентации. Остальные поля элемента им не мешают. */
export interface BrowsableDeck {
  readonly title: string;
  /** Последняя правка, мс с эпохи. */
  readonly updatedAt: number;
}

/**
 * Строка для сравнения при поиске: без регистра, «ё» как «е», пробелы схлопнуты. Так
 * «ИТОГИ  квартала» находит «Итоги квартала», а «ещё» — «еще».
 */
export function searchKey(text: string, locale?: string): string {
  return text.toLocaleLowerCase(locale).replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/** Презентации, в названии которых есть запрос. Пустой запрос ничего не отсеивает. */
export function filterDecks<T extends BrowsableDeck>(
  decks: readonly T[],
  query: string,
  locale?: string,
): readonly T[] {
  const needle = searchKey(query, locale);
  if (needle === '') return decks;
  return decks.filter((deck) => searchKey(deck.title, locale).includes(needle));
}

/**
 * Презентации в выбранном порядке, без правки исходного массива. «Недавние» — свежие первыми,
 * при равном времени по названию; «По названию» — по алфавиту языка интерфейса, числа как
 * числа («Спринт 2» раньше «Спринт 10»), при равных названиях свежие первыми.
 */
export function sortDecks<T extends BrowsableDeck>(
  decks: readonly T[],
  sort: DeckSort,
  locale?: string,
): readonly T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title);
  const byRecent = (a: T, b: T) => b.updatedAt - a.updatedAt;
  return [...decks].sort(
    sort === 'recent'
      ? (a, b) => byRecent(a, b) || byTitle(a, b)
      : (a, b) => byTitle(a, b) || byRecent(a, b),
  );
}
