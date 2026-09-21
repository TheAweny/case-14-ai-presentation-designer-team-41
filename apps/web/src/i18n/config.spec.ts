import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, negotiateLocale, resolveLocale } from './config';

describe('negotiateLocale', () => {
  it('берёт первый знакомый язык по убыванию веса', () => {
    expect(negotiateLocale('de-DE,de;q=0.9,en;q=0.8,ru;q=0.7')).toBe('en');
  });

  it('отбрасывает регион и регистр', () => {
    expect(negotiateLocale('en-GB')).toBe('en');
    expect(negotiateLocale('RU-ru')).toBe('ru');
  });

  it('при равном весе держит порядок заголовка', () => {
    expect(negotiateLocale('en;q=0.5,ru;q=0.5')).toBe('en');
  });

  it('не берёт язык, который браузер просит не показывать', () => {
    expect(negotiateLocale('en;q=0,ru;q=0.1')).toBe('ru');
  });

  it('без знакомых языков ничего не выбирает', () => {
    expect(negotiateLocale('de,fr;q=0.8,*;q=0.1')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
  });

  it('не верит мусору', () => {
    expect(negotiateLocale(';;,q=abc,ru;q=x')).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('ставит выбор пользователя выше браузера', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'ru' })).toBe('en');
  });

  it('пропускает чужое значение cookie', () => {
    expect(resolveLocale({ cookie: 'de', acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
  });

  it('без подсказок берёт язык по умолчанию', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ cookie: null, acceptLanguage: 'de' })).toBe(DEFAULT_LOCALE);
  });
});
