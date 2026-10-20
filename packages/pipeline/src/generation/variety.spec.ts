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

  it('leaves a plan that already varies the layouts as it is', () => {
    const planned = plan(['cover', 'A', 'B', 'D', 'C', 'E']);
    const { slides, moved, repeated } = diversifyPlan(planned, catalog, notes, options);
    expect(slides).toEqual(planned);
    expect(moved).toEqual([]);
    expect(repeated).toEqual([]);
  });

  it('moves a repeat within the share to a layout the deck has not shown yet', () => {
    const { slides, moved } = diversifyPlan(
      plan(['cover', 'A', 'B', 'A', 'C', 'B', 'D']),
      catalog,
      notes,
      options,
    );
    const ids = slides.map((s) => s.patternId);
    expect(ids[3]).not.toBe('A');
    expect(moved.length).toBeGreaterThan(0);
    // With every three-block layout shown, a further repeat within the share stays.
    expect(new Set(ids.slice(1)).size).toBeGreaterThanOrEqual(4);
  });

  it('never puts one layout on two slides in a row', () => {
    const { slides } = diversifyPlan(plan(['cover', 'A', 'A', 'B', 'B']), catalog, notes, options);
    const ids = slides.map((s) => s.patternId);
    expect(ids.some((id, i) => i >= 1 && ids[i - 1] === id)).toBe(false);
  });

  it('treats two ids with the same geometry next to each other as a repeat', () => {
    const twins = [pattern('cover', 1), pattern('A', 3), pattern('A2', 3), pattern('B', 3)];
    const { slides } = diversifyPlan(plan(['cover', 'A', 'A2']), twins, new Map(), {
      ...options,
      structure: (p: (typeof twins)[number]) => (p.patternId.startsWith('A') ? 'a' : p.patternId),
    });
    expect(slides.map((s) => s.patternId)).toEqual(['cover', 'A', 'B']);
  });

  it('prefers the layout with the same number of blocks, then the one used least', () => {
    const { moved } = diversifyPlan(plan(['cover', 'A', 'A', 'A']), catalog, notes, options);
    // B and C hold three blocks like A; D holds four and is only the next choice.
    expect(moved).toHaveLength(2);
    expect(moved.map((m) => m.to).sort()).toEqual(['B', 'C']);
  });

  it('alternates rather than repeat a layout next to itself when the template is poor', () => {
    const poor = [pattern('cover', 1), pattern('A', 3), pattern('far', 8)];
    const { slides } = diversifyPlan(
      plan(['cover', 'A', 'A', 'A', 'A']),
      poor,
      new Map([['cover', note('cover')]]),
      options,
    );
    const ids = slides.map((s) => s.patternId);
    expect(ids.some((id, i) => i >= 1 && ids[i - 1] === id)).toBe(false);
  });

  it('says so, and keeps the layout, when the template has nothing else at all', () => {
    const poor = [pattern('cover', 1), pattern('A', 3)];
    const { slides, repeated } = diversifyPlan(
      plan(['cover', 'A', 'A']),
      poor,
      new Map([['cover', note('cover')]]),
      options,
    );
    expect(repeated.map((r) => r.index)).toEqual([2]);
    expect(slides.map((s) => s.patternId)).toEqual(['cover', 'A', 'A']);
  });

  it('keeps the cover first and shows a single page of the template once', () => {
    const { slides } = diversifyPlan(
      plan(['cover', 'code', 'A', 'code', 'B']),
      catalog,
      notes,
      options,
    );
    const ids = slides.map((s) => s.patternId);
    expect(ids[0]).toBe('cover');
    expect(ids.filter((id) => id === 'code')).toHaveLength(1);
    expect(ids[3]).not.toBe('needs-data');
  });

  it('moves a slide off a layout next to itself even when that drops its chart', () => {
    const { slides, repeated, forced } = diversifyPlan(plan(['cover', 'A', 'A']), catalog, notes, {
      ...options,
      compatible: () => false,
    });
    const ids = slides.map((s) => s.patternId);
    expect(ids[2]).not.toBe('A');
    expect(['needs-data', 'code', 'cover']).not.toContain(ids[2]);
    expect(forced).toEqual([2]);
    expect(repeated).toEqual([]);
  });

  it('keeps a repeat that is not next to itself when only an incompatible layout is free', () => {
    const { slides } = diversifyPlan(plan(['cover', 'A', 'B', 'A']), catalog, notes, {
      ...options,
      compatible: () => false,
    });
    expect(slides.map((s) => s.patternId)).toEqual(['cover', 'A', 'B', 'A']);
  });
});
