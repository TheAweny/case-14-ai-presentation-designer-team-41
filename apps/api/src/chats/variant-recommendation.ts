import type { LayoutVariant } from '@lct/contracts';

/** One completed layout and the audit counts that could be read for it. */
export interface VariantRecommendationInput {
  readonly variant: LayoutVariant;
  readonly errors: number | null;
  readonly warnings: number | null;
}

export interface VariantRecommendation {
  readonly variant: LayoutVariant;
  /** Preference is used only when no audit count is available for any candidate. */
  readonly basis: 'audit' | 'preference';
}

const PREFERENCE: readonly LayoutVariant[] = ['balanced', 'dense', 'airy'];

/** Prefer known lower error and warning counts; missing counts never mean zero or passed. */
export function recommendVariant(
  variants: readonly VariantRecommendationInput[],
): VariantRecommendation {
  const known = variants.some((item) => item.errors !== null || item.warnings !== null);
  const best = [...variants].sort((a, b) => {
    if (known) {
      const errorOrder = compareKnown(a.errors, b.errors);
      if (errorOrder !== 0) return errorOrder;
      const warningOrder = compareKnown(a.warnings, b.warnings);
      if (warningOrder !== 0) return warningOrder;
    }
    return PREFERENCE.indexOf(a.variant) - PREFERENCE.indexOf(b.variant);
  })[0];

  if (!best) throw new Error('No variants to recommend.');
  return { variant: best.variant, basis: known ? 'audit' : 'preference' };
}

function compareKnown(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}
