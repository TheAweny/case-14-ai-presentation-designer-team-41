import type { CompositionCritique, DeckOutline, FinalReview } from '@lct/contracts';

/** Every approved claim needs visible copy or a critic judgment with a verifiable excerpt. */
export function approvedCoverage(
  outline: DeckOutline | null | undefined,
  written: readonly {
    index: number;
    slide: { texts: readonly { text: string }[]; visual?: unknown };
  }[],
  evidence: CompositionCritique['coverage'],
): FinalReview['coverage'] {
  const missing: FinalReview['coverage']['missing'] = [];
  let total = 0;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  for (const [slideIndex, slide] of (outline?.slides ?? []).entries()) {
    const actual = written.find((s) => s.index === slideIndex)?.slide;
    const visible = normalize(
      [
        ...(actual?.texts.map((t) => t.text) ?? []),
        actual?.visual ? JSON.stringify(actual.visual) : '',
      ].join('\n'),
    );
    for (const [claimIndex, text] of [slide.title, ...slide.points].entries()) {
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
