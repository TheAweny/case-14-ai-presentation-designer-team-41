import { claimSchema, type Claim } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkQuantity,
  nameIsGrounded,
  numberIsGrounded,
  quoteOccurs,
  type NumberToken,
} from './claim-check.js';

const SOURCE = 'Выручка выросла на 25% в 2024 году. В 2023 году было 10%.';

function parse(payload: Record<string, unknown>): Claim {
  return claimSchema.parse(payload);
}

function userClaim(overrides: Record<string, unknown> = {}): Claim {
  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    status: 'user',
    claimId: 'c-revenue',
    statement: 'Выручка выросла на 25% в 2024 году.',
    sourceId: 'brief-1',
    quote: 'Выручка выросла на 25% в 2024 году',
    locator: { page: 1 },
    value: 25,
    unit: '%',
    period: '2024',
    scope: 'Выручка',
    ...overrides,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }
  return parse(payload);
}

function webClaim(overrides: Record<string, unknown> = {}): Claim {
  return parse({
    schemaVersion: 1,
    status: 'web',
    claimId: 'c-web',
    statement: 'Выручка выросла на 25% в 2024 году.',
    sourceId: 'src-web',
    quote: 'Выручка выросла на 25% в 2024 году',
    locator: { url: 'https://example.com/reports/2024' },
    accepted: false,
    value: 25,
    unit: '%',
    period: '2024',
    scope: 'Выручка',
    ...overrides,
  });
}

describe('quoteOccurs', () => {
  it('is true only for a non-empty exact substring', () => {
    expect(quoteOccurs('Выручка выросла на 25%', SOURCE)).toBe(true);
    expect(quoteOccurs('25%', SOURCE)).toBe(true);
    expect(quoteOccurs(SOURCE, SOURCE)).toBe(true);
    expect(quoteOccurs('', SOURCE)).toBe(false);
    expect(quoteOccurs('нет такой фразы', SOURCE)).toBe(false);
  });

  it('does not fold case, whitespace, or punctuation', () => {
    expect(quoteOccurs('выручка выросла на 25%', SOURCE)).toBe(false);
    expect(quoteOccurs('Выручка  выросла на 25%', SOURCE)).toBe(false);
    expect(quoteOccurs('25 %', SOURCE)).toBe(false);
    expect(quoteOccurs('25', '125')).toBe(true);
  });
});

function figure(
  value: number,
  unit: string | null,
  period: string | null,
  scope: string | null,
): NumberToken {
  return { value, unit, period, scope };
}

const REVENUE = figure(25, '%', '2024', 'Выручка');

function located(token: NumberToken, claim: Claim, numberAndUnit: boolean) {
  expect(checkQuantity(token, claim)).toEqual({
    numberAndUnit,
    support: numberAndUnit ? 'unverified' : 'mismatch',
  });
  expect(numberIsGrounded(token, claim)).toBe(false);
}

describe('checkQuantity', () => {
  it('locates a user figure and still leaves the object unverified', () => {
    const claim = userClaim();
    located(REVENUE, claim, true);
    located(figure(25, null, null, null), claim, false);
  });

  it('accepts an accepted web claim when the whole numeric context matches', () => {
    const claim = webClaim({ accepted: true });
    located(REVENUE, claim, true);
    located(figure(25, '%', '2024', null), claim, false);
  });

  it('refuses a token that leaves out the object the claim records', () => {
    const claim = userClaim();
    located(figure(25, '%', '2024', 'Выручка'), claim, true);
    located(figure(25, '%', '2024', 'прибыль'), claim, false);
    located(figure(25, '%', '2024', null), claim, false);
  });

  it('refuses a web claim the person has not accepted', () => {
    located(REVENUE, webClaim(), false);
  });

  it('refuses an assumption, a contradiction, and an insufficient record', () => {
    const assumption = parse({
      schemaVersion: 1,
      status: 'assumption',
      claimId: 'a-review',
      statement: 'Сначала согласуем критерий полноты',
      kind: 'process',
    });
    const contradiction = parse({
      schemaVersion: 1,
      status: 'contradiction',
      claimId: 'c-conflict',
      statement: 'В брифе 25%, в приложении 30%.',
    });
    const insufficient = parse({
      schemaVersion: 1,
      status: 'insufficient',
      claimId: 'c-gap',
      statement: 'Период не указан.',
    });
    located(REVENUE, assumption, false);
    located(REVENUE, contradiction, false);
    located(REVENUE, insufficient, false);
  });

  it('refuses a different value, unit, or period', () => {
    const claim = userClaim();
    located(figure(10, '%', '2024', 'Выручка'), claim, false);
    located(figure(25, 'п.п.', '2024', 'Выручка'), claim, false);
    located(figure(25, '%', '2023', 'Выручка'), claim, false);
    located(figure(Number.NaN, '%', '2024', 'Выручка'), claim, false);
  });

  it('refuses a value the quote does not contain, even when the claim records it', () => {
    const claim = userClaim({ value: 99 });
    if (claim.status !== 'user') throw new Error('expected a user claim');
    expect(quoteOccurs(claim.quote, SOURCE)).toBe(true);
    expect(claim.quote).toContain('25%');
    located(figure(99, '%', '2024', 'Выручка'), claim, false);
  });

  it('does not treat a bare 25 in the source as the claim', () => {
    expect(SOURCE.includes('25')).toBe(true);
    const quotedOnly = userClaim({
      value: undefined,
      unit: undefined,
      period: undefined,
      scope: undefined,
    });
    if (quotedOnly.status !== 'user') throw new Error('expected a user claim');
    expect(quoteOccurs('25', quotedOnly.quote)).toBe(true);
    located(figure(25, null, null, null), quotedOnly, false);
    located(figure(25, '%', '2024', null), quotedOnly, false);

    const recorded = userClaim();
    located(figure(25, 'домов', '2024', 'Выручка'), recorded, false);
    const embedded = userClaim({
      quote: '250 домов',
      statement: '250 домов',
      value: 25,
      unit: 'домов',
      period: undefined,
      scope: undefined,
    });
    located(figure(25, 'домов', null, null), embedded, false);
  });

  it('reads the sign and the decimal instead of a digit substring', () => {
    const minus = userClaim({
      quote: 'Маржа составила -25%',
      statement: 'Маржа составила -25%',
      value: 25,
      scope: 'Маржа',
      period: undefined,
    });
    located(figure(25, '%', null, 'Маржа'), minus, false);
    located(
      figure(-25, '%', null, 'Маржа'),
      userClaim({
        quote: 'Маржа составила -25%',
        statement: 'Маржа составила -25%',
        value: -25,
        scope: 'Маржа',
        period: undefined,
      }),
      true,
    );

    const dotted = userClaim({
      quote: 'Маржа составила 25.7%',
      statement: 'Маржа составила 25.7%',
      value: 25,
      scope: 'Маржа',
      period: undefined,
    });
    located(figure(25, '%', null, 'Маржа'), dotted, false);
    located(
      figure(25.7, '%', null, 'Маржа'),
      userClaim({
        quote: 'Маржа составила 25.7%',
        statement: 'Маржа составила 25.7%',
        value: 25.7,
        scope: 'Маржа',
        period: undefined,
      }),
      true,
    );

    const grouped = userClaim({
      quote: 'Доля составила 1,25%',
      statement: 'Доля составила 1,25%',
      value: 25,
      scope: 'Доля',
      period: undefined,
    });
    located(figure(25, '%', null, 'Доля'), grouped, false);
    located(
      figure(1.25, '%', null, 'Доля'),
      userClaim({
        quote: 'Доля составила 1,25%',
        statement: 'Доля составила 1,25%',
        value: 1.25,
        scope: 'Доля',
        period: undefined,
      }),
      true,
    );

    const comma = userClaim({
      quote: 'Маржа составила 25,7%',
      statement: 'Маржа составила 25,7%',
      value: 25.7,
      scope: 'Маржа',
      period: undefined,
    });
    located(figure(25.7, '%', null, 'Маржа'), comma, true);
    located(figure(25, '%', null, 'Маржа'), comma, false);
  });

  it('locates figures that share a quote and confirms none of them', () => {
    const quote = 'Выручка: 25% за 2024 год. Прибыль: 99% за 2024 год.';
    const mixed = userClaim({ quote, statement: quote, value: 99, scope: 'Выручка' });
    located(figure(99, '%', '2024', 'Выручка'), mixed, true);
    located(figure(25, '%', '2024', 'Выручка'), userClaim({ quote, statement: quote }), true);

    const years = 'Выручка выросла на 25% в 2024 году, а в 2023 году было 10%.';
    const shifted = userClaim({ quote: years, statement: years, period: '2023' });
    located(figure(25, '%', '2023', 'Выручка'), shifted, true);
  });

  it('does not treat a mentioned object as the owner of the only figure', () => {
    const quote = 'Выручка не указана, прибыль выросла на 99% в 2024 году.';
    const claim = userClaim({ quote, statement: quote, value: 99 });
    located(figure(99, '%', '2024', 'Выручка'), claim, true);
  });

  it('compares a unit in full and does not treat a word as a missing unit', () => {
    const millimetres = userClaim({
      quote: 'Длина: 25 мм.',
      statement: 'Длина: 25 мм.',
      value: 25,
      unit: 'м',
      period: undefined,
      scope: 'Длина',
    });
    located(figure(25, 'м', null, 'Длина'), millimetres, false);
    located(
      figure(25, 'мм', null, 'Длина'),
      userClaim({
        quote: 'Длина: 25 мм.',
        statement: 'Длина: 25 мм.',
        value: 25,
        unit: 'мм',
        period: undefined,
        scope: 'Длина',
      }),
      true,
    );

    const price = userClaim({
      quote: 'Цена: 25 рублей.',
      statement: 'Цена: 25 рублей.',
      value: 25,
      unit: undefined,
      period: undefined,
      scope: 'Цена',
    });
    located(figure(25, null, null, 'Цена'), price, false);
  });

  it('keeps a decimal point inside the figure when a period is also written', () => {
    const quote = 'Маржа: 25.7% за 2024 год.';
    const claim = userClaim({
      quote,
      statement: quote,
      value: 25.7,
      scope: 'Маржа',
    });
    located(figure(25.7, '%', '2024', 'Маржа'), claim, true);
    located(figure(25, '%', '2024', 'Маржа'), claim, false);
  });
});

describe('nameIsGrounded', () => {
  it('accepts a name quoted by a user claim', () => {
    const claim = userClaim({
      statement: 'Доклад готовит Анна Иванова.',
      quote: 'Доклад готовит Анна Иванова',
      value: undefined,
      unit: undefined,
      period: undefined,
      scope: undefined,
    });
    expect(nameIsGrounded('Анна Иванова', claim)).toBe(true);
    expect(nameIsGrounded('анна иванова', claim)).toBe(false);
  });

  it('refuses a contradiction, an insufficient record, and an unaccepted web claim', () => {
    const contradiction = parse({
      schemaVersion: 1,
      status: 'contradiction',
      claimId: 'c-name',
      statement: 'В брифе Анна Иванова, в подписи Анна И.',
    });
    const insufficient = parse({
      schemaVersion: 1,
      status: 'insufficient',
      claimId: 'c-who',
      statement: 'Имя автора не подтверждено: Анна.',
    });
    expect(nameIsGrounded('Анна Иванова', contradiction)).toBe(false);
    expect(nameIsGrounded('Анна', insufficient)).toBe(false);
    expect(nameIsGrounded('Выручка', webClaim())).toBe(false);
    expect(nameIsGrounded('Выручка', webClaim({ accepted: true }))).toBe(true);
  });

  it('refuses an empty name', () => {
    expect(nameIsGrounded('', userClaim())).toBe(false);
  });
});
