import type { CompositionNote } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import { diversifyPlan } from './variety.js';

const pattern = (patternId: string, blocks: number, chars = 100) => ({
  patternId,
  slots: Array.from({ length: blocks }, () => ({ maxChars: chars })),
});
const catalog = [
  pattern('cover', 1),
  pattern('A', 3),
  pattern('B', 3, 120),
  pattern('C', 3, 90),
  pattern('D', 4),
  pattern('E', 5),
  pattern('needs-data', 3),
  pattern('code', 3),
];
const note = (kind: string, extra: Partial<CompositionNote> = {}) =>
  ({
    patternId: '',
    kind,
    items: 0,
    title: '',
    useFor: '',
    special: false,
    requiredContent: [],
    ...extra,
  }) as CompositionNote;
const notes = new Map<string, CompositionNote>([
  ['cover', note('cover')],
  ['needs-data', note('content', { requiredContent: ['quantitative-data'] })],
  ['code', note('content', { special: true })],
]);
const options = {
  limit: 2,
  blocks: (p: (typeof catalog)[number]) => p.slots.length,
  capacity: (p: (typeof catalog)[number]) => p.slots.reduce((sum, s) => sum + s.maxChars, 0),
  structure: (p: (typeof catalog)[number]) => p.patternId,
};
const plan = (ids: string[]) => ids.map((patternId) => ({ patternId, purpose: patternId }));

describe('diversifyPlan', () => {
  it('moves a layout used more than its share and never three in a row to one that holds the same points', () => {
    const { slides, moved } = diversifyPlan(
      plan(['cover', 'A', 'A', 'A', 'A', 'A', 'A']),
      catalog,
      notes,
      options,
    );
    const ids = slides.map((s) => s.patternId);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(
      Math.max(...[...counts].filter(([id]) => id !== 'cover').map(([, n]) => n)),
    ).toBeLessThanOrEqual(2);
    expect(ids.some((id, i) => i >= 2 && ids[i - 1] === id && ids[i - 2] === id)).toBe(false);
    expect(ids[0]).toBe('cover');
    // Every move kept the number of blocks within one, and never took a layout needing data or code.
    for (const { from, to } of moved) {
      const a = catalog.find((p) => p.patternId === from);
      const b = catalog.find((p) => p.patternId === to);
      expect(Math.abs((a?.slots.length ?? 0) - (b?.slots.length ?? 0))).toBeLessThanOrEqual(1);
      expect(['needs-data', 'code', 'cover']).not.toContain(to);
    }
    // The planner's other fields stay with the slide.
    expect(slides.map((s) => s.purpose)).toEqual(['cover', 'A', 'A', 'A', 'A', 'A', 'A']);
  });

  it('stays on a layout when every other one is refused', () => {
    const { slides, repeated } = diversifyPlan(plan(['cover', 'A', 'A', 'A']), catalog, notes, {
      ...options,
      limit: 1,
      allowsMove: (_index, to) => to.patternId === 'A',
    });
    expect(slides.map((slide) => slide.patternId)).toEqual(['cover', 'A', 'A', 'A']);
    expect(repeated.map((slide) => slide.index)).toEqual([2, 3]);
  });

  it('leaves a plan that already varies the layouts as it is', () => {
    const planned = plan(['cover', 'A', 'B', 'A', 'C', 'B', 'D']);
    const { slides, moved, repeated } = diversifyPlan(planned, catalog, notes, options);
    expect(slides).toEqual(planned);
    expect(moved).toEqual([]);
    expect(repeated).toEqual([]);
  });

  it('prefers the layout with the same number of blocks, then the one used least', () => {
    const { moved } = diversifyPlan(plan(['cover', 'A', 'A', 'A']), catalog, notes, options);
    // B and C hold three blocks like A; D holds four and is only the second choice.
    expect(moved).toHaveLength(1);
    expect(['B', 'C']).toContain(moved[0]?.to);
  });

  it('says so, and keeps the layout, when the template has nothing else that holds the points', () => {
    const poor = [pattern('cover', 1), pattern('A', 3), pattern('far', 8)];
    const { slides, moved, repeated } = diversifyPlan(
      plan(['cover', 'A', 'A', 'A', 'A']),
      poor,
      new Map([['cover', note('cover')]]),
      options,
    );
    expect(moved).toEqual([]);
    expect(repeated.map((r) => r.index)).toEqual([3, 4]);
    expect(slides.map((s) => s.patternId)).toEqual(['cover', 'A', 'A', 'A', 'A']);
  });

  it('does not touch the cover, a framing slide or a layout made for its content', () => {
    const { slides } = diversifyPlan(
      plan(['cover', 'code', 'code', 'code', 'code']),
      catalog,
      notes,
      options,
    );
    expect(slides.map((s) => s.patternId)).toEqual(['cover', 'code', 'code', 'code', 'code']);
  });
});
