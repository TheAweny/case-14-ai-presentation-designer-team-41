import { describe, expect, it } from 'vitest';
import { schemaAnchors } from './heading-anchor.js';

describe('schema heading anchors', () => {
  it('uses the lowercase slug Fumadocs puts on the heading', () => {
    const anchors = schemaAnchors(['ChatDocument', 'RunConfig']);
    expect(anchors.get('ChatDocument')).toBe('chatdocument');
    expect(anchors.get('RunConfig')).toBe('runconfig');
  });

  it('drops punctuation and turns spaces into hyphens', () => {
    const anchors = schemaAnchors(['Foo Bar', 'Foo_Bar']);
    expect(anchors.get('Foo Bar')).toBe('foo-bar');
    expect(anchors.get('Foo_Bar')).toBe('foobar');
  });

  it('suffixes a later heading when two names share a slug', () => {
    const anchors = schemaAnchors(['Chat', 'chat']);
    const [first, second] = ['Chat', 'chat'].sort((left, right) => left.localeCompare(right));
    if (first === undefined || second === undefined) throw new Error('Expected two schema names');
    expect(anchors.get(first)).toBe('chat');
    expect(anchors.get(second)).toBe('chat-1');
  });
});
