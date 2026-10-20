import { slotVisualSchema } from '@lct/contracts';
import { normalizeEvidence } from './dataset-evidence.js';
import { visualVisibleText } from './visual-grounding.js';

const tokens = (text: string) =>
  normalizeEvidence(text).match(/[+−-]?\d+(?:[.,]\d+)?|[\p{L}]+|[%₽$€]/gu) ?? [];

/** Exact token sequences only: semantic equivalence needs an independent entailment check.
 * Punctuation/whitespace are harmless; numbers, sign, units, conditions and negations are not.
 * A matching clause surrounded by a changed condition or negation is not a proof either.
 */
export function claimVisible(claim: string, visible: string): boolean {
  const expected = tokens(claim);
  if (!expected.length) return false;
  const complete = tokens(visible);
  if (expected.length === complete.length && expected.every((token, i) => token === complete[i]))
    return true;
  // Do not concatenate unrelated slots or source metadata to fabricate a sentence.
  const withoutAbbreviations = visible.replace(
    /(?<!\p{L})(руб|тыс|шт|чел|сек|мин|долл)\./giu,
    '$1',
  );
  return withoutAbbreviations.split(/[\n;!?]|\.(?!\d)/u).some((clause) => {
    const actual = tokens(clause);
    // Keep leading/trailing qualifications; a subphrase can reverse meaning in context.
    return expected.length === actual.length && expected.every((token, i) => token === actual[i]);
  });
}

export function visibleVisual(visual: unknown): string[] {
  const parsed = slotVisualSchema.safeParse(visual);
  return parsed.success ? visualVisibleText(parsed.data) : [];
}
