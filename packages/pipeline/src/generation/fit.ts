/**
 * The last resort before export: the engine refuses a deck with a slot its text overflows, and a
 * deck with one shorter line is worth more than no deck. A slot goes back to the last copy the
 * engine measured as fitting; without one, it loses whole lines, then whole words, until it fits.
 */

export interface FitLimit {
  /** Lines the text took, as the engine measured it. */
  readonly lines: number;
  readonly maxLines: number;
  readonly maxChars: number;
}

/** Trailing punctuation and dashes a cut leaves hanging. */
const DANGLING = /[\s,;:—–-]+$/u;

/** One step shorter, cutting where a reader would: a line first, then words, never mid-word. */
export function shortened(text: string, limit: FitLimit): string {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length > 1) {
    const keep = Math.max(1, Math.min(limit.maxLines, lines.length - 1));
    return lines.slice(0, keep).join('\n');
  }
  const line = lines[0] ?? '';
  // The share of the text that fits, by the lines the engine measured.
  const target = Math.min(
    limit.maxChars,
    Math.floor((line.length * limit.maxLines) / Math.max(limit.lines, limit.maxLines + 1)),
  );
  const words = line.split(/\s+/);
  let kept = '';
  for (const word of words) {
    const next = kept ? `${kept} ${word}` : word;
    if (next.length > target) break;
    kept = next;
  }
  if (!kept || kept === line) kept = words.slice(0, -1).join(' ');
  return (kept || line.slice(0, Math.max(1, target))).replace(DANGLING, '');
}

/** Average width of a character as a share of its size: the engine's measure without a font. */
const CHAR_WIDTH_EM = 0.6;

/** The longest word of a text in characters, without the punctuation hanging on it. */
export function longestWord(text: string): number {
  return Math.max(
    0,
    ...text
      .split(/\s+/)
      .map((word) => word.replace(/^[.,;:!?«»"'()[\]]+|[.,;:!?«»"'()[\]]+$/gu, '').length),
  );
}

/**
 * Whether a word of the text is surely wider than the slot's text box, so a line would be torn in
 * the middle of it. This is an estimate by the size and width of the slot; the engine measures
 * with the template font and has the last word. Without the slot's width nothing is claimed.
 */
export function tearsAWord(
  text: string,
  slot: { fontSize?: number; textWidthPt?: number },
): boolean {
  if (!slot.fontSize || !slot.textWidthPt) return false;
  return longestWord(text) * slot.fontSize * CHAR_WIDTH_EM > slot.textWidthPt;
}
