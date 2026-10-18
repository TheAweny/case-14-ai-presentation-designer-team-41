import { describe, expect, it } from 'vitest';
import { calculate } from './calculation.js';

describe('independent calculation counterexamples', () => {
  it('does not compare values in different units as a percentage change', () => {
    expect(() =>
      calculate({
        operation: 'percentage_change',
        values: [
          { value: 18, unit: 'min' },
          { value: 11, unit: 'kg' },
        ],
      }),
    ).toThrow();
  });

  it('keeps direction meaningful for a negative baseline', () => {
    const result = calculate({
      operation: 'percentage_change',
      values: [
        { value: -18, unit: 'RUB' },
        { value: -11, unit: 'RUB' },
      ],
    });
    expect(result.result.value).toBeCloseTo(38.8888888889);
    expect(result.direction).toBe('increase');
  });

  it('distinguishes a monetary effect per minute from minutes used as a monetary effect', () => {
    const result = calculate({
      operation: 'payback',
      period: 'minutes',
      values: [
        { value: 1000, unit: 'RUB' },
        { value: 250, unit: 'RUB' },
      ],
    });
    expect(result.result).toEqual({ value: 4, unit: 'minutes' });
    expect(() =>
      calculate({
        operation: 'payback',
        period: 'month',
        values: [
          { value: 1000, unit: 'RUB' },
          { value: 7, unit: 'minutes' },
        ],
      }),
    ).toThrow();
  });

  it('rejects empty unit labels and negative investment', () => {
    expect(() => calculate({ operation: 'sum', values: [{ value: 1, unit: '  ' }] })).toThrow();
    expect(() =>
      calculate({
        operation: 'payback',
        period: 'month',
        values: [
          { value: -1000, unit: 'RUB' },
          { value: 250, unit: 'RUB' },
        ],
      }),
    ).toThrow();
  });
});
