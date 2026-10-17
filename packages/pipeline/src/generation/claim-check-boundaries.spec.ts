import { claimSchema, type Claim } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import { checkQuantity, numberIsGrounded, type NumberToken } from './claim-check.js';

const NBSP = '\u00a0';
const NARROW_NBSP = '\u202f';

function parse(payload: Record<string, unknown>): Claim {
  return claimSchema.parse(payload);
}

function userClaim(overrides: Record<string, unknown> = {}): Claim {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    status: 'user',
    claimId: 'c-boundary',
    statement: 'Цена: 25 рублей.',
    sourceId: 'brief-1',
    quote: 'Цена: 25 рублей.',
    locator: { page: 1 },
    value: 25,
    unit: 'рублей',
    scope: 'Цена',
    ...overrides,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return parse(payload);
}

function figure(
  value: number,
  unit: string | null,
  period: string | null = null,
  scope: string | null = null,
): NumberToken {
  return { value, unit, period, scope };
}

function expectLocated(token: NumberToken, claim: Claim): void {
  expect(checkQuantity(token, claim)).toEqual({
    numberAndUnit: true,
    support: 'unverified',
  });
  expect(numberIsGrounded(token, claim)).toBe(false);
}

function expectRejected(token: NumberToken, claim: Claim): void {
  expect(checkQuantity(token, claim)).toEqual({
    numberAndUnit: false,
    support: 'mismatch',
  });
  expect(numberIsGrounded(token, claim)).toBe(false);
}

describe('quantity boundaries', () => {
  it.each(['\n', '\r\n', NBSP, NARROW_NBSP])(
    'does not lose a currency unit after whitespace %j',
    (space) => {
      const quote = `Цена: 25${space}₽.`;
      expectRejected(figure(25, null, null, 'Цена'), userClaim({ quote, unit: undefined }));
      expectLocated(figure(25, '₽', null, 'Цена'), userClaim({ quote, unit: '₽' }));
    },
  );

  it.each(['м / с', 'м · с', 'м ^ 2'])('does not accept the prefix of spaced unit %s', (unit) => {
    const quote = `Длина: 25 ${unit}.`;
    expectRejected(figure(25, 'м', null, 'Длина'), userClaim({ quote, unit: 'м', scope: 'Длина' }));
    expectLocated(figure(25, unit, null, 'Длина'), userClaim({ quote, unit, scope: 'Длина' }));
  });

  it('locates a figure without a unit at the end of a sentence', () => {
    expectLocated(
      figure(25, null, null, 'Цена'),
      userClaim({ quote: 'Цена: 25.', unit: undefined }),
    );
  });

  it.each([' ', NBSP, NARROW_NBSP])(
    'locates a complete grouped signed decimal with separator %j',
    (space) => {
      const quote = `Цена: −1${space}025,5 ₽.`;
      expectLocated(
        figure(-1025.5, '₽', null, 'Цена'),
        userClaim({ quote, value: -1025.5, unit: '₽' }),
      );
    },
  );

  it.each(['м²', 'м/с', '₽'])('locates the complete unit %s', (unit) => {
    const quote = `Значение: 25 ${unit}.`;
    expectLocated(
      figure(25, unit, null, 'Значение'),
      userClaim({ quote, value: 25, unit, scope: 'Значение' }),
    );
  });

  it.each(['1 02 025', '1,025.25', '--25'])(
    'does not extract a suffix from malformed %s',
    (written) => {
      const quote = `Цена: ${written} рублей.`;
      expectRejected(figure(25, 'рублей', null, 'Цена'), userClaim({ quote }));
    },
  );

  it.each([
    ['ordinary space', '1 025 рублей'],
    ['nbsp', `1${NBSP}025 рублей`],
    ['narrow nbsp', `1${NARROW_NBSP}025 рублей`],
  ])('does not read 25 рублей out of %s in 1 025', (_label, written) => {
    const quote = `Стоимость: ${written}.`;
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25,
      unit: 'рублей',
      scope: 'Стоимость',
    });
    expectRejected(figure(25, 'рублей', null, 'Стоимость'), claim);
  });

  it.each(['м²', 'м/с'])('does not read the unit м out of 25 %s', (unit) => {
    const quote = `Скорость: 25 ${unit}.`;
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25,
      unit: 'м',
      scope: 'Скорость',
    });
    expectRejected(figure(25, 'м', null, 'Скорость'), claim);
  });

  it('does not treat 25 ₽ as a number with no unit', () => {
    const quote = 'Цена: 25 ₽.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25,
      unit: undefined,
      scope: 'Цена',
    });
    expectRejected(figure(25, null, null, 'Цена'), claim);
  });

  it('locates a plain integer and still leaves the claim unverified', () => {
    const quote = 'Выручка выросла на 25% в 2024 году.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25,
      unit: '%',
      period: '2024',
      scope: 'Выручка',
    });
    expectLocated(figure(25, '%', '2024', 'Выручка'), claim);
  });

  it('locates a signed decimal written with a comma and its full unit', () => {
    const quote = 'Маржа составила -25,7%.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: -25.7,
      unit: '%',
      scope: 'Маржа',
    });
    expectLocated(figure(-25.7, '%', null, 'Маржа'), claim);
    expectRejected(figure(25.7, '%', null, 'Маржа'), claim);
    expectRejected(figure(-25, '%', null, 'Маржа'), claim);
  });

  it('locates a decimal written with a dot and its full unit', () => {
    const quote = 'Длина: 25.7 мм.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25.7,
      unit: 'мм',
      scope: 'Длина',
    });
    expectLocated(figure(25.7, 'мм', null, 'Длина'), claim);
    expectRejected(figure(25.7, 'м', null, 'Длина'), claim);
  });

  it('does not confirm the source or the object by locating the figure', () => {
    const quote = 'Выручка выросла на 25%.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25,
      unit: '%',
      scope: 'Выручка',
    });
    const result = checkQuantity(figure(25, '%', null, 'Выручка'), claim);
    expect(result.numberAndUnit).toBe(true);
    expect(result.support).toBe('unverified');
    expect(result.support).not.toBe('grounded');
    expect(numberIsGrounded(figure(25, '%', null, 'Выручка'), claim)).toBe(false);
  });
});
