/** Detect a command at the caret, including Cyrillic queries and text after the caret. */
export function promptToken(text: string, caret: number) {
  const head = text.slice(0, caret);
  const match = /(^|\s)([@/])([\p{L}\p{N}_-]*)$/u.exec(head);
  if (!match) return null;
  return {
    kind: match[2] === '@' ? ('source' as const) : ('command' as const),
    query: (match[3] ?? '').toLocaleLowerCase(),
    start: match.index + (match[1]?.length ?? 0),
    end: caret,
  };
}
