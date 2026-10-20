import { describe, expect, it } from 'vitest';
import type { RequiredSlideClaim, SlotVisual } from '@lct/contracts';
import { approvedCoverage } from './final-review.js';
const claim = (text: string): RequiredSlideClaim => ({
  id: 'claim',
  text,
  source: { sourceId: 'brief', quote: text },
});
const coverage = (text: string, actual: string, quote?: string) =>
  approvedCoverage(
    null,
    [{ index: 0, requiredClaims: [claim(text)], slide: { texts: [{ text: actual }] } }],
    quote ? [{ slideIndex: 0, claimIndex: 0, quote }] : [],
  );
describe('claim-specific coverage evidence', () => {
  it.each([
    ['Выручка: 10', 'Выручка: 100'],
    ['Выручка: -10', 'Выручка: 10'],
    ['Выручка: 10 млн руб.', 'Выручка: 10 тыс руб.'],
    ['Январь: 10, Февраль: 20', 'Январь: 20, Февраль: 10'],
    ['Пилот ещё не проводился', 'Пилот завершён'],
    ['Пилот проведён', 'Пилот не проведён'],
    ['Пилот проведён', 'Если пилот проведён'],
    ['Выручка: 10 млн руб.', 'Выручка: 10 млн руб. только при оплате'],
  ])('does not cover %s with %s, even with a critic quote', (text, actual) => {
    expect(coverage(text, actual, actual)).toMatchObject({ covered: 0, status: 'requires-review' });
  });
  it.each([
    'Выручка: 0',
    'Выручка: -10 млн руб.',
    'Нет данных за март',
    'Пилот ещё не проводился',
    'Только при предоплате до 15 октября',
  ])('accepts a complete visible claim: %s', (text) => {
    expect(coverage(text, `${text}.`)).toMatchObject({
      covered: 1,
      status: 'verified',
      unknown: [],
    });
  });
  it('rejects an unrelated quote from the same slide', () => {
    expect(
      coverage('Пилот ещё не проводился', 'Рост продаж. Пилот завершён.', 'Рост продаж').covered,
    ).toBe(0);
  });
  it('does not treat unverified paraphrase as proved', () => {
    expect(
      coverage('Пилот ещё не проводился', 'Испытание пока впереди', 'Испытание пока впереди')
        .unknown,
    ).toHaveLength(1);
  });
  it('does not join independent slots into an invented relationship', () => {
    expect(
      approvedCoverage(
        null,
        [
          {
            index: 0,
            requiredClaims: [claim('Выручка 10')],
            slide: { texts: [{ text: 'Выручка' }, { text: '10' }] },
          },
        ],
        [],
      ).covered,
    ).toBe(0);
  });
  it('does not count source quotes or notes inside visual metadata as visible proof', () => {
    const visual: SlotVisual = {
      kind: 'native',
      slotId: 'body',
      block: {
        kind: 'chart',
        intent: 'time-series',
        categories: [{ label: 'Январь' }],
        series: [
          {
            name: 'Выручка',
            unit: 'млн руб.',
            values: [{ state: 'present', literal: '10', value: 10 }],
          },
        ],
        sources: [{ itemId: 'brief', status: 'grounded', quote: 'Пилот ещё не проводился' }],
        xTitle: '',
        yTitle: 'млн руб.',
      },
    };
    const written = [
      {
        index: 0,
        requiredClaims: [claim('Пилот ещё не проводился')],
        slide: { texts: [], visual },
      },
    ];
    expect(approvedCoverage(null, written, []).covered).toBe(0);
    required(written[0]).requiredClaims = [claim('Выручка: Январь 10 млн руб.')];
    expect(approvedCoverage(null, written, []).covered).toBe(1);
  });
  it('explicitly reports unknown when no requirements were checked', () => {
    expect(
      approvedCoverage(null, [{ index: 0, slide: { texts: [{ text: 'Текст' }] } }], []),
    ).toMatchObject({ total: 0, covered: 0, status: 'unknown' });
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
}
