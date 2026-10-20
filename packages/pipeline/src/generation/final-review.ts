import type {
  CompositionCritique,
  DeckOutline,
  FinalReview,
  RequiredSlideClaim,
} from '@lct/contracts';
import { claimVisible, visibleVisual } from './claim-evidence.js';

export type CoverageReview = FinalReview['coverage'] & {
  status: 'verified' | 'requires-review' | 'unknown';
  /** Includes unsupported paraphrases; missing means unconfirmed, not necessarily absent. */
  unknown: FinalReview['coverage']['missing'];
};

/** Every approved claim needs visible copy or a critic judgment with a verifiable excerpt. */
export function approvedCoverage(
  outline: DeckOutline | null | undefined,
  written: readonly {
    index: number;
    requiredClaims?: readonly RequiredSlideClaim[];
    slide: { texts: readonly { text: string }[]; visual?: unknown };
  }[],
  evidence: CompositionCritique['coverage'],
): CoverageReview {
  const missing: FinalReview['coverage']['missing'] = [];
  let total = 0;
  const claims =
    outline?.slides.map((slide, index) => ({ index, texts: [slide.title, ...slide.points] })) ??
    written.map((slide) => ({
      index: slide.index,
      texts: (slide.requiredClaims ?? []).map((claim) => claim.text),
    }));
  for (const { index: slideIndex, texts } of claims) {
    const actual = written.find((s) => s.index === slideIndex)?.slide;
    const visible = [...(actual?.texts.map((t) => t.text) ?? []), ...visibleVisual(actual?.visual)];
    for (const [claimIndex, text] of texts.entries()) {
      total++;
      const quotes = evidence
        .filter((e) => e.slideIndex === slideIndex && e.claimIndex === claimIndex)
        .map((entry) => entry.quote);
      if (
        !visible.some((value) => claimVisible(text, value)) &&
        !quotes.some(
          (quote) =>
            claimVisible(text, quote) && visible.some((value) => claimVisible(quote, value)),
        )
      ) {
        missing.push({ slideIndex, claimIndex, text });
      }
    }
  }
  return {
    total,
    covered: total - missing.length,
    missing,
    status: total === 0 ? 'unknown' : missing.length ? 'requires-review' : 'verified',
    unknown: [...missing],
  };
}
