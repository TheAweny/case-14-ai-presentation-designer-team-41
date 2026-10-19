/**
 * Fumadocs assigns GitHub-style heading ids: lowercase, punctuation removed,
 * spaces turned into hyphens. Repeated ids on one page get `-1`, `-2`, …
 */
export function headingAnchor(value: string, used: Map<string, number>): string {
  const base = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]+/gu, '')
    .replace(/ /g, '-');
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

/** Anchors for schema headings in the order the reference page emits them. */
export function schemaAnchors(names: string[]): Map<string, string> {
  const used = new Map<string, number>();
  const anchors = new Map<string, string>();
  for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
    anchors.set(name, headingAnchor(name, used));
  }
  return anchors;
}
