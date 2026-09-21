import { describe, expect, it } from 'vitest';
import {
  isLiteralElement,
  isPluralElement,
  isPoundElement,
  isSelectElement,
  isTagElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './config';
import en from './messages/en.json';
import ru from './messages/ru.json';

const DICTIONARIES: Record<Locale, unknown> = { ru, en };

/** Все строки словаря с путями через точку — такими, какими их видит `t()`. */
function flatten(node: unknown, prefix = ''): Map<string, string> {
  if (typeof node === 'string') return new Map([[prefix, node]]);
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    throw new Error(`${prefix || '<корень>'}: в словаре бывают только строки и вложенные объекты`);
  }
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    for (const entry of flatten(value, prefix ? `${prefix}.${key}` : key)) result.set(...entry);
  }
  return result;
}

/**
 * Что сообщение ждёт от кода: имена аргументов и теги. Переводчик волен менять слова и формы
 * множественного числа, но не набор значений, которые подставляет код, — иначе строка либо
 * упадёт, либо покажет пользователю фигурные скобки.
 */
function placeholders(elements: MessageFormatElement[], found = new Set<string>()): Set<string> {
  for (const element of elements) {
    if (isLiteralElement(element) || isPoundElement(element)) continue;
    if (isTagElement(element)) {
      found.add(`<${element.value}>`);
      placeholders(element.children, found);
      continue;
    }
    found.add(element.value);
    if (isPluralElement(element) || isSelectElement(element)) {
      for (const option of Object.values(element.options)) placeholders(option.value, found);
    }
  }
  return found;
}

/** Разбор с указанием, какая строка сломана: сам парсер пишет только позицию. */
function expectedPlaceholders(locale: Locale, key: string, text: string): string[] {
  try {
    return [...placeholders(parse(text))].sort();
  } catch (error) {
    throw new Error(`${locale}: ${key}: ${(error as Error).message}`, { cause: error });
  }
}

const FLAT = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(DICTIONARIES[locale])]),
) as Record<Locale, Map<string, string>>;

/** Исходный словарь — тот, по которому проверяются типы ключей. */
const SOURCE = FLAT[DEFAULT_LOCALE];
const TRANSLATIONS = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);

describe('словари интерфейса', () => {
  it.each(TRANSLATIONS)('%s содержит ровно те же ключи, что и исходный', (locale) => {
    expect([...FLAT[locale].keys()].sort()).toEqual([...SOURCE.keys()].sort());
  });

  it.each(LOCALES)('%s не содержит пустых строк', (locale) => {
    const empty = [...FLAT[locale]].filter(([, text]) => text.trim() === '').map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it.each(LOCALES)('%s разбирается как ICU и ждёт тех же значений, что исходный', (locale) => {
    for (const [key, text] of FLAT[locale]) {
      const source = SOURCE.get(key);
      if (source === undefined) continue;
      expect(expectedPlaceholders(locale, key, text), `${locale}: ${key}`).toEqual(
        expectedPlaceholders(DEFAULT_LOCALE, key, source),
      );
    }
  });
});

describe('placeholders', () => {
  it('не путает текст ветки множественного числа с аргументом', () => {
    const message = '{count, plural, one {# слайд} other {слайдов}} в <b>{name}</b>';
    expect([...placeholders(parse(message))].sort()).toEqual(['<b>', 'count', 'name']);
  });
});
