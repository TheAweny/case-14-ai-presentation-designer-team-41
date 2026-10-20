/**
 * Copy for a slide whose writer did not answer in time: the plan's own words, cut to each box.
 * No model is asked, so it is ready at once. The slide says what the plan says it must say; the
 * audit and the review warning tell the person it was not written by the model.
 */
import { tearsAWord } from './fit.js';

export interface FallbackSlot {
  slotId: string;
  role: string;
  /** Characters the box holds at the template's size. */
  fitChars: number;
  /** Size and width of the box, when known: a word wider than the box is never set in it. */
  fontSize?: number;
  textWidthPt?: number;
}

export interface FallbackSource {
  /** The slide title the person approved, when there is one. */
  slideTitle?: string | undefined;
  purpose: string;
  claims: readonly string[];
}

/** Trailing punctuation a cut leaves hanging. */
const DANGLING = /[\s,.;:—–-]+$/u;

/**
 * The longest whole part of a text that fits: the text itself, else its leading clauses (cut at
 * a dash, a colon, a semicolon, a comma or a sentence end), else its leading words. Never a word
 * cut in the middle and never an ellipsis: a short statement reads as written, a torn one does not.
 */
export function clip(
  text: string,
  limit: number,
  slot: Omit<FallbackSlot, 'slotId' | 'role' | 'fitChars'> = {},
): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (limit <= 0) return '';
  const fits = (candidate: string) =>
    candidate.length > 0 && candidate.length <= limit && !tearsAWord(candidate, slot);
  if (fits(clean)) return clean;
  const clauses = [...clean.matchAll(/[^—:;,.!?]+(?:[—:;,.!?]|$)/gu)].map((m) => m[0]);
  for (let count = clauses.length - 1; count >= 1; count--) {
    const candidate = clauses.slice(0, count).join('').replace(DANGLING, '').trim();
    if (fits(candidate)) return candidate;
  }
  const words = clean.split(' ');
  for (let count = words.length - 1; count >= 2; count--) {
    const candidate = words.slice(0, count).join(' ').replace(DANGLING, '');
    if (fits(candidate)) return candidate;
  }
  return '';
}

/** The claim of a purpose: «claim — point; point» gives «claim», a paragraph its first sentence. */
function firstSentence(text: string): string {
  const claim = text.split(/\s+—\s+/u)[0] ?? text;
  return /^(.+?[.!?])(\s|$)/u.exec(claim.trim())?.[1] ?? claim.trim();
}

export function fallbackTexts(
  slots: readonly FallbackSlot[],
  source: FallbackSource,
): Record<string, string> {
  const texts: Record<string, string> = {};
  const headline = slots.find((slot) => slot.role === 'title');
  if (headline) {
    texts[headline.slotId] = clip(
      source.slideTitle?.trim() || firstSentence(source.purpose),
      headline.fitChars,
      headline,
    );
  }
  const body = slots.filter((slot) => slot !== headline);
  const claims = source.claims.map((claim) => claim.trim()).filter(Boolean);
  // A claim that fits a box whole goes before one that would have to be cut.
  const room = Math.min(...body.map((slot) => slot.fitChars), Number.POSITIVE_INFINITY);
  const lines = [
    ...claims.filter((claim) => claim.length <= room),
    ...claims.filter((claim) => claim.length > room),
  ];
  if (lines.length < body.length && source.purpose.trim()) lines.push(source.purpose.trim());
  body.forEach((slot, index) => {
    const isLast = index === body.length - 1;
    // Claims beyond the last box go into it, one a line: a fact is cut short, never dropped.
    const text = isLast ? lines.slice(index).join('\n') : (lines[index] ?? '');
    texts[slot.slotId] = text
      .split('\n')
      .map((line) => clip(line, slot.fitChars, slot))
      .filter(Boolean)
      .join('\n');
  });
  return texts;
}
