import { describe, expect, it } from 'vitest';
import { recommendVariant } from './variant-recommendation.js';

const variants = [
  { variant: 'dense' as const, errors: 0, warnings: 0 },
  { variant: 'balanced' as const, errors: 5, warnings: 0 },
  { variant: 'airy' as const, errors: null, warnings: null },
];

describe('recommendVariant', () => {
  it('uses known audit counts even when another variant has no audit', () => {
    expect(recommendVariant(variants)).toEqual({ variant: 'dense', basis: 'audit' });
  });

  it('compares known warnings after errors while keeping missing counts unknown', () => {
    expect(
      recommendVariant([
        { variant: 'dense', errors: 0, warnings: 3 },
        { variant: 'balanced', errors: 0, warnings: 1 },
        { variant: 'airy', errors: null, warnings: null },
      ]),
    ).toEqual({ variant: 'balanced', basis: 'audit' });
  });

  it('prefers a known count to an unknown count without treating unknown as zero', () => {
    expect(
      recommendVariant([
        { variant: 'dense', errors: null, warnings: null },
        { variant: 'balanced', errors: 0, warnings: 0 },
      ]),
    ).toEqual({ variant: 'balanced', basis: 'audit' });
  });

  it('uses the preferred variant when every audit count is unknown', () => {
    expect(
      recommendVariant([
        { variant: 'airy', errors: null, warnings: null },
        { variant: 'dense', errors: null, warnings: null },
      ]),
    ).toEqual({ variant: 'dense', basis: 'preference' });
  });

  it('throws when there are no completed variants', () => {
    expect(() => recommendVariant([])).toThrow('No variants to recommend.');
  });
});
