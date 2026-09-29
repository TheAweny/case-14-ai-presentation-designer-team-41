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
