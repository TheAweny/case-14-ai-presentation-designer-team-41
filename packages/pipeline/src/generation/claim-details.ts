import type { RequiredSlideClaim } from '@lct/contracts';

const normalize = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const negated = (text: string) =>
  /(?:^|[^\p{L}])(?:не|нет|без|нельзя|никогда|not|no|without)(?:$|[^\p{L}])/iu.test(text);
const conditioned = (text: string) =>
  /(?:^|[^\p{L}])(?:если|при|только|условии|if|when|only)(?:$|[^\p{L}])/iu.test(text);

/** A conservative loss guard, not a substitute for the semantic critic. */
export function retainsClaimDetails(
  before: string,
  after: string,
  claims: readonly RequiredSlideClaim[],
): boolean {
  const old = normalize(before);
  const next = normalize(after);
  for (const claim of claims) {
    const text = normalize(claim.text);
    // Keep complete numbers and their adjacent unit; do not match 15 inside 150.
    for (const match of text.matchAll(
      /(?<![\p{L}\p{N}])[+-]?\d+(?:[.,]\d+)?\s*(?:%|[\p{L}]+)?/gu,
    )) {
      const detail = match[0].trim();
      // A calendar suffix labels the year, not a measurement unit. The same year may
      // remain in another slot or use its short form; real units still stay literal.
      const calendarYear = /^([12]\d{3})\s+(?:год|года|году|годом|г|year|years)$/u.exec(detail);
      const literal = calendarYear?.[1] ?? detail;
      const occurs = (value: string) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}])${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
          'u',
        ).test(value);
      if (occurs(old) && !occurs(next)) return false;
    }
    if (negated(text) && negated(old) && !negated(next)) return false;
    if (conditioned(text) && conditioned(old) && !conditioned(next)) return false;
  }
  return true;
}
