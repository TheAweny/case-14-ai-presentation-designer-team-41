import { describe, expect, it } from 'vitest';
import { compositionNoteSchema } from './generation.js';

const note = {
  patternId: 'layout-1',
  kind: 'cards' as const,
  items: 2,
  useFor: 'two cards',
  title: 'Two cards',
  skip: false,
  special: false,
};

describe('composition note semantics', () => {
  it('still parses an index note written before semantic roles', () => {
    const parsed = compositionNoteSchema.parse(note);
    expect(parsed.slotSemantics).toBeUndefined();
    expect(parsed.groups).toBeUndefined();
    expect(parsed.requiredContent).toEqual([]);
  });

  it('accepts roles and groups and rejects a 201st slot or a 41st group', () => {
    const parsed = compositionNoteSchema.parse({
      ...note,
      slotSemantics: [{ slotId: 'body-1', role: 'card-heading', groupId: 'card-1' }],
      groups: [{ id: 'card-1', kind: 'card', slotIds: ['body-1', 'body-2'] }],
    });
    expect(parsed.slotSemantics?.[0]?.role).toBe('card-heading');
    expect(
      compositionNoteSchema.safeParse({
        ...note,
        slotSemantics: Array.from({ length: 201 }, (_, index) => ({
          slotId: `s-${index}`,
          role: 'body',
        })),
      }).success,
    ).toBe(false);
    expect(
      compositionNoteSchema.safeParse({
        ...note,
        groups: Array.from({ length: 41 }, (_, index) => ({
          id: `g-${index}`,
          kind: 'column',
          slotIds: ['body-1'],
        })),
      }).success,
    ).toBe(false);
    expect(
      compositionNoteSchema.safeParse({
        ...note,
        slotSemantics: [{ slotId: 'body-1', role: 'headline' }],
      }).success,
    ).toBe(false);
  });
});
