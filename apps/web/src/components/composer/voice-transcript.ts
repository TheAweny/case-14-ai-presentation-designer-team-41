/** Append a transcript to the draft, keeping one space between what was typed and what was said. */
export function appendTranscript(draft: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return draft;
  const base = draft.replace(/\s+$/, '');
  return base ? `${base} ${text}` : text;
}
