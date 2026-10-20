import { describe, expect, it } from 'vitest';
import type { RequiredSlideClaim } from '@lct/contracts';
import { retainsClaimDetails } from './claim-details.js';

function keeps(before: string, after: string, claim = before) {
  const required: RequiredSlideClaim = {
    id: 'required-detail',
    text: claim,
    source: { sourceId: 'brief', quote: claim },
  };
  return retainsClaimDetails(before, after, [required]);
}

describe('claim detail calendar notation', () => {
  it.each(['2026 год', '2026 года', '2026 году', '2026 г.', '2026 year'])(
    'accepts a shorter notation of %s',
    (year) => {
      expect(keeps(`Итоги за ${year}`, 'Итоги за 2026')).toBe(true);
    },
  );

  it('accepts the same calendar year retained in a separate date slot', () => {
    expect(keeps('Итоги 2026 года\n2026', 'Итоги\n2026', 'Итоги 2026 года')).toBe(true);
  });

  it.each(['Итоги', 'Итоги 2025', 'Итоги 20260'])(
    'rejects losing or changing the calendar year: %s',
    (after) => {
      expect(keeps('Итоги 2026 года', after)).toBe(false);
    },
  );

  it.each([
    ['Повтор через 15 минут', 'Повтор через 15 секунд'],
    ['Лимит 2026 минут', 'Лимит 2026'],
    ['Рост 15%', 'Рост 150%'],
    ['Выручка 1,5 млн', 'Выручка 1,5'],
    ['При сбое отправки нет; повтор через 15 минут', 'Отправка; повтор через 15 минут'],
  ])('keeps measurement units, complete numbers, negation and conditions', (before, after) => {
    expect(keeps(before, after)).toBe(false);
  });

  it('accepts the reported shorter heading while retaining the half-year and date', () => {
    expect(
      keeps(
        'СеверПоток Облако: результаты первого полугодия 2026 года',
        'СеверПоток Облако — итоги января–июня 2026',
      ),
    ).toBe(true);
  });

  it.each([
    ['Период 2025–2026 года', 'Период 2025–2026'],
    ['Период 1–6 месяцев', 'Период 1–6 месяцев'],
  ])('keeps numeric range endpoints', (before, after) => {
    expect(keeps(before, after)).toBe(true);
  });

  it.each([
    ['Период 2025–2026 года', 'Период 2025'],
    ['Период 2025–2026 года', 'Период 2026'],
    ['Период 1–6 месяцев', 'Период 1–5 месяцев'],
    ['Период 1–6 месяцев', 'Период 1–6 недель'],
  ])('rejects losing range endpoints or changing their units', (before, after) => {
    expect(keeps(before, after)).toBe(false);
  });

  it('does not confuse a duration in years with a calendar suffix', () => {
    expect(keeps('Срок 15 лет', 'Срок 15')).toBe(false);
    expect(keeps('Срок 2 года', 'Срок 2')).toBe(false);
  });
});
