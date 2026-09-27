import { contentPackSchema, type ContentItem, type ContentPack } from '@lct/contracts';

/** A document the user supplied: pasted text, a file read as text, a page of a repository. */
export interface SourceDocument {
  readonly title?: string;
  readonly text: string;
  readonly origin?: string;
}

export interface ContentPackInput {
  readonly briefId: string;
  /** What the deck has to achieve, as the user typed it. */
  readonly goal: string;
  readonly audience?: string;
  readonly language: string;
  readonly documents?: readonly SourceDocument[];
}

/** Longest passage one item carries, so a quote stays checkable and a prompt stays small. */
const MAX_ITEM_CHARS = 1_200;

/**
 * Turns the user's brief and documents into a ContentPack, deterministically.
 *
 * Each document is cut at blank lines into passages, and a markdown heading becomes the title
 * of the passages under it. Every passage gets a stable id, which is what a slide cites; the
 * brief itself is an item too, so a deck can quote what the user asked for.
 */
export function buildContentPack(input: ContentPackInput): ContentPack {
  const items: ContentItem[] = [
    { itemId: 'brief', kind: 'brief', title: '', text: input.goal.trim(), origin: '' },
  ];
  (input.documents ?? []).forEach((document, d) => {
    let heading = document.title?.trim() ?? '';
    let n = 0;
    for (const block of document.text.split(/\n\s*\n/)) {
      const lines = block.trim().split('\n');
      const first = lines[0] ?? '';
      const title = /^#{1,6}\s+/.exec(first);
      if (title !== null) {
        heading = first.replace(/^#{1,6}\s+/, '').trim();
        lines.shift();
      }
      const text = lines.join('\n').trim();
      for (const part of chunk(text)) {
        n += 1;
        items.push({
          itemId: `doc${d + 1}-p${n}`,
          kind: /^\s*\|.*\|\s*$/m.test(part) ? 'table' : 'text',
          title: heading,
          text: part,
          origin: document.origin ?? '',
        });
      }
    }
  });
  return contentPackSchema.parse({
    schemaVersion: 1,
    packId: `pack-${input.briefId}`,
    briefId: input.briefId,
    language: input.language,
    goal: input.goal.trim(),
    audience: input.audience?.trim() ?? '',
    items,
  });
}

function chunk(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= MAX_ITEM_CHARS) {
    return [text];
  }
  const parts: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (current.length > 0 && current.length + sentence.length + 1 > MAX_ITEM_CHARS) {
      parts.push(current);
      current = sentence;
    } else {
      current = current.length > 0 ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}
