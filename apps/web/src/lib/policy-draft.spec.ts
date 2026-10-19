import { describe, expect, it } from 'vitest';
import {
  blankLimit,
  countSliderMax,
  fromUnitAmount,
  limitMode,
  samePolicy,
  setLimit,
  setMode,
  shownMode,
  storageSliderMax,
  storageUnitFor,
  toUnitAmount,
  STORAGE_UNIT_BYTES,
} from './policy-draft';

describe('policy draft', () => {
  it('tells a missing key from an explicit unlimited value', () => {
    expect(limitMode({}, 'generation')).toBe('inherit');
    expect(limitMode({ generation: null }, 'generation')).toBe('unlimited');
    expect(limitMode({ generation: blankLimit('generation', 'UTC') }, 'generation')).toBe(
      'limited',
    );
    expect(shownMode({}, 'generation', true)).toBe('unlimited');
    expect(shownMode({}, 'generation', false)).toBe('inherit');
  });

  it('edits one metric and keeps storage on a lifetime window', () => {
    const inherited = setMode({ generation: null }, 'generation', 'inherit', 'UTC');
    expect(inherited).toEqual({});
    const limited = setMode({}, 'storage', 'limited', 'Europe/Moscow');
    expect(limited.storage).toMatchObject({ period: 'lifetime', timezone: 'UTC' });
    const shifted = setLimit(limited, 'storage', { period: 'day', timezone: 'Europe/Moscow' });
    expect(shifted.storage).toMatchObject({ period: 'lifetime', timezone: 'UTC' });
    expect(samePolicy(limited, shifted)).toBe(true);
    expect(samePolicy({}, { generation: null })).toBe(false);
  });

  it('converts storage units without dropping a whole gigabyte', () => {
    expect(storageUnitFor(2 * STORAGE_UNIT_BYTES.gb)).toBe('gb');
    expect(storageUnitFor(1536 * STORAGE_UNIT_BYTES.mb)).toBe('mb');
    expect(storageUnitFor(12 * STORAGE_UNIT_BYTES.kb)).toBe('kb');
    expect(fromUnitAmount(1.5, 'gb')).toBe(Math.round(1.5 * STORAGE_UNIT_BYTES.gb));
    expect(toUnitAmount(STORAGE_UNIT_BYTES.mb, 'mb')).toBe(1);
    expect(storageSliderMax(1.5, 'gb')).toBe(10);
    expect(countSliderMax(80)).toBe(100);
  });
});
