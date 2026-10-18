import { describe, expect, it } from 'vitest';
import { calculate, calculationInputSchema } from './calculation.js';

describe('calculate', () => {
  it('turns 18 into 11 as a decrease of about 38.889 percent', () => {
    const result = calculate({
      operation: 'percentage_change',
      values: [
        { value: 18, unit: 'шт', source: 'было' },
        { value: 11, unit: 'шт', source: 'стало' },
      ],
    });
    expect(result.result.value).toBeCloseTo(((11 - 18) / 18) * 100, 10);
    expect(result.result.unit).toBe('%');
    expect(result.direction).toBe('decrease');
    expect(result.formula).toContain('11');
    expect(result.formula).toContain('18');
    expect(result.inputs[0]).toEqual({ value: 18, unit: 'шт', source: 'было' });
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
  });

  it('rejects a sum of different units', () => {
    expect(() =>
      calculate({
        operation: 'sum',
        values: [
          { value: 2, unit: 'кг' },
          { value: 3, unit: 'м' },
        ],
      }),
    ).toThrow(/одной единице/);
  });

  it('rejects division by zero', () => {
    expect(() =>
      calculate({
        operation: 'ratio',
        values: [
          { value: 5, unit: 'шт' },
          { value: 0, unit: 'шт' },
        ],
      }),
    ).toThrow(/ноль/);
  });

  it('rejects payback without a monetary effect', () => {
    expect(() =>
      calculate({
        operation: 'payback',
        period: 'year',
        values: [{ value: 1000, unit: 'RUB', source: 'смета' }],
      }),
    ).toThrow(/денежный эффект/);
  });

  it('accepts a minute period when both amounts are currency and rejects minutes as money', () => {
    const result = calculate({
      operation: 'payback',
      period: 'minutes',
      values: [
        { value: 1000, unit: 'RUB', source: 'смета' },
        { value: 250, unit: 'RUB', source: 'эффект' },
      ],
    });
    expect(result.result).toEqual({ value: 4, unit: 'minutes' });
    expect(result.inputs.map((item) => item.source)).toEqual(['смета', 'эффект']);
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
    expect(() =>
      calculate({
        operation: 'payback',
        period: 'month',
        values: [
          { value: 1000, unit: 'RUB' },
          { value: 7, unit: 'minutes' },
        ],
      }),
    ).toThrow(/валют/);
  });

  it('rejects a non-finite product', () => {
    expect(() =>
      calculate({
        operation: 'product',
        values: [
          { value: 1e308, unit: 'шт' },
          { value: 10, unit: 'шт' },
        ],
      }),
    ).toThrow(/конечн/);
  });

  it('keeps the schema closed to non-finite numbers', () => {
    expect(
      calculationInputSchema.safeParse({
        operation: 'sum',
        values: [{ value: Number.POSITIVE_INFINITY, unit: 'шт' }],
      }).success,
    ).toBe(false);
  });
});
