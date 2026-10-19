import { describe, expect, it } from 'vitest';
import { tokenPriceResolver } from './pricing.js';
describe('exact model tariff revisions', () => {
  it('keeps aliases unknown and retains currency, date and version', () => {
    const resolve = tokenPriceResolver({
      version: 'fixture-v1',
      effectiveAt: '2026-10-19T00:00:00Z',
      source: 'https://example.test/pricing',
      models: { 'test/revision-1': { currency: 'RUB', inputPerMillion: 10, outputPerMillion: 20 } },
    });
    expect(resolve('test/latest')).toBeUndefined();
    expect(resolve('test/revision-1')).toMatchObject({
      currency: 'RUB',
      version: 'fixture-v1@2026-10-19T00:00:00Z',
    });
  });
});
