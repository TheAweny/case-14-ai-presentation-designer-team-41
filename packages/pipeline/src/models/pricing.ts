import { z } from 'zod';
import type { TokenPrice } from './attempt-ledger.js';

/** Operator-supplied rates for exact model revisions; absent rows remain unknown. */
export const tokenPriceCatalogSchema = z.object({
  version: z.string().min(1),
  source: z.string().url(),
  effectiveAt: z.string().datetime(),
  models: z.record(
    z.string(),
    z.object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      inputPerMillion: z.number().finite().nonnegative(),
      outputPerMillion: z.number().finite().nonnegative(),
    }),
  ),
});
export function tokenPriceResolver(value: unknown): (model: string) => TokenPrice | undefined {
  const catalog = tokenPriceCatalogSchema.parse(value);
  return (model) => {
    const rate = catalog.models[model];
    return rate ? { ...rate, version: `${catalog.version}@${catalog.effectiveAt}` } : undefined;
  };
}
