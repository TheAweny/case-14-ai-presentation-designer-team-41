import type {
  CompositionCritique,
  DeckOutline,
  FinalReview,
  RequiredSlideClaim,
} from '@lct/contracts';

/** Every approved claim needs visible copy or a critic judgment with a verifiable excerpt. */
export function approvedCoverage(
  outline: DeckOutline | null | undefined,
  written: readonly {
    index: number;
    requiredClaims?: readonly RequiredSlideClaim[];
    slide: { texts: readonly { text: string }[]; visual?: unknown };
  }[],
  evidence: CompositionCritique['coverage'],
): FinalReview['coverage'] {
  const missing: FinalReview['coverage']['missing'] = [];
  let total = 0;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const claims =
    outline?.slides.map((slide, index) => ({ index, texts: [slide.title, ...slide.points] })) ??
    written.map((slide) => ({
      index: slide.index,
      texts: (slide.requiredClaims ?? []).map((claim) => claim.text),
    }));
  for (const { index: slideIndex, texts } of claims) {
    const actual = written.find((s) => s.index === slideIndex)?.slide;
    const visible = normalize(
      [
        ...(actual?.texts.map((t) => t.text) ?? []),
        actual?.visual ? JSON.stringify(actual.visual) : '',
      ].join('\n'),
    );
    for (const [claimIndex, text] of texts.entries()) {
      total++;
      const quote = evidence.find(
        (e) => e.slideIndex === slideIndex && e.claimIndex === claimIndex,
      )?.quote;
      if (
        !visible.includes(normalize(text)) &&
        !(quote?.trim() && visible.includes(normalize(quote)))
      ) {
        missing.push({ slideIndex, claimIndex, text });
      }
    }
  }
  return { total, covered: total - missing.length, missing };
}
