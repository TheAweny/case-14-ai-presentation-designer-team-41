import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { slideIrSchema, type SlideElement, type SlideIr } from '@lct/contracts';
import type { DeckCommit } from './core.js';
import { commitArrange, commitDuplicate, commitPaste } from './element-ops.js';
import { commitGroup, commitMoveLayer, commitUngroup } from './group-ops.js';
import { commitRemove, createDeckHistory, recordChange, undoDeck } from './journal.js';
import { layerTree, prunedLayers, type LayerNode } from './layers.js';

function shape(elementId: string, groupIds?: readonly string[]): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    shape: 'rect',
    fill: 'accent',
    stroke: null,
    ...(groupIds ? { groupIds: [...groupIds] } : null),
  };
}

function slideOf(elements: readonly SlideElement[]): SlideIr {
  return {
    schemaVersion: 1,
    slideId: 'cards',
    variant: 'balanced',
    index: 0,
    patternId: 'pattern',
    slideCx: 12_192_000,
    slideCy: 6_858_000,
    elements: [...elements],
  };
}

function counter(prefix: string): () => string {
  let count = 0;
  return () => `${prefix}-${(count += 1)}`;
}

function replay(slides: readonly SlideIr[], patches: readonly Patch[]): readonly SlideIr[] {
  return applyPatches(slides as SlideIr[], [...patches]);
}

function expectReversible(before: readonly SlideIr[], commit: DeckCommit): void {
  expect(commit.change).not.toBeNull();
  for (const item of commit.slides) expect(slideIrSchema.parse(item)).toEqual(item);
  expect(replay(before, commit.change?.patches ?? [])).toEqual(commit.slides);
  expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(before);
  const history = recordChange(createDeckHistory(before), commit);
  expect(history.undo).toHaveLength(1);
  expect(undoDeck(history).slides).toEqual(before);
}

/** The slide as `id` or `id:group/group`, lowest first. */
function layout(commit: DeckCommit | readonly SlideIr[]): string[] {
  const slides = 'slides' in commit ? commit.slides : commit;
  return (slides[0]?.elements ?? []).map((element) =>
    element.groupIds ? `${element.elementId}:${element.groupIds.join('/')}` : element.elementId,
  );
}

describe('layer tree', () => {
  it('hangs elements under their groups and gathers a group that was apart', () => {
    const tree = layerTree([
      shape('a', ['g']),
      shape('b'),
      shape('c', ['g', 'h']),
      shape('d', ['g', 'h']),
    ]);
    const outline = (nodes: readonly LayerNode[]): unknown[] =>
      nodes.map((node) =>
        node.kind === 'element' ? node.id : { [node.id]: outline(node.children) },
      );
    expect(outline(tree)).toEqual([{ g: ['a', { h: ['c', 'd'] }] }, 'b']);
  });

  it('drops groups of one and lifts what they held', () => {
    const tree = prunedLayers(layerTree([shape('a', ['g', 'h']), shape('b', ['g', 'h'])]));
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'group', id: 'h', path: ['h'] });
  });
});

describe('group', () => {
  it('groups elements where the topmost of them was and selects the group', () => {
    const slides = [slideOf([shape('a'), shape('b'), shape('c'), shape('d')])];
    const commit = commitGroup(slides, {
      slideId: 'cards',
      elementIds: ['c', 'a'],
      nextId: counter('group'),
    });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['b', 'a:group-1', 'c:group-1', 'd']);
    expect(commit.change?.kind).toBe('group');
    expect(commit.change?.after?.elementIds).toEqual(['a', 'c']);
  });

  it('nests a group picked whole inside the new one', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    const commit = commitGroup(slides, {
      slideId: 'cards',
      elementIds: ['a', 'b', 'c'],
      groupId: 'outer',
    });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['a:outer/g', 'b:outer/g', 'c:outer']);
  });

  it('groups inside a group when the elements are all in it', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c', ['g'])])];
    const commit = commitGroup(slides, { slideId: 'cards', elementIds: ['b', 'c'], groupId: 'h' });
    expect(layout(commit)).toEqual(['a:g', 'b:g/h', 'c:g/h']);
  });

  it('never reuses an id the slide already has', () => {
    const slides = [slideOf([shape('a', ['taken']), shape('b', ['taken']), shape('c')])];
    const commit = commitGroup(slides, {
      slideId: 'cards',
      elementIds: ['a', 'b', 'c'],
      groupId: 'taken',
      nextId: counter('fresh'),
    });
    expect(layout(commit)).toEqual(['a:fresh-1/taken', 'b:fresh-1/taken', 'c:fresh-1']);
  });

  it('changes nothing for one element, one group or a whole group again', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    for (const elementIds of [['c'], ['a', 'b'], ['missing']]) {
      expect(commitGroup(slides, { slideId: 'cards', elementIds }).change).toBeNull();
    }
  });
});

describe('ungroup', () => {
  it('takes a group apart in place, keeps its members selected and inner groups whole', () => {
    const slides = [
      slideOf([shape('a', ['g']), shape('b', ['g', 'h']), shape('c', ['g', 'h']), shape('d')]),
    ];
    const commit = commitUngroup(slides, { slideId: 'cards', elementIds: ['a', 'b', 'c'] });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['a', 'b:h', 'c:h', 'd']);
    expect(commit.change?.kind).toBe('ungroup');
    expect(commit.change?.after?.elementIds).toEqual(['a', 'b', 'c']);
  });

  it('changes nothing when no group is picked whole', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    expect(commitUngroup(slides, { slideId: 'cards', elementIds: ['a'] }).change).toBeNull();
    expect(commitUngroup(slides, { slideId: 'cards', elementIds: ['c'] }).change).toBeNull();
  });

  it('undoes a grouping exactly', () => {
    const slides = [slideOf([shape('a'), shape('b'), shape('c')])];
    const grouped = commitGroup(slides, { slideId: 'cards', elementIds: ['a', 'c'] });
    const apart = commitUngroup(grouped.slides, { slideId: 'cards', elementIds: ['a', 'c'] });
    expect(layout(apart)).toEqual(['b', 'a', 'c']);
  });
});

describe('paint order with groups', () => {
  const slides = [slideOf([shape('a'), shape('b', ['g']), shape('c', ['g']), shape('d')])];

  it('moves a group past a whole neighbour, never into another group', () => {
    const forward = commitArrange(slides, {
      slideId: 'cards',
      elementIds: ['a'],
      to: 'forward',
    });
    expectReversible(slides, forward);
    expect(layout(forward)).toEqual(['b:g', 'c:g', 'a', 'd']);
    const back = commitArrange(slides, { slideId: 'cards', elementIds: ['b', 'c'], to: 'back' });
    expect(layout(back)).toEqual(['b:g', 'c:g', 'a', 'd']);
  });

  it('keeps an element inside its group, at most at the top of it', () => {
    const front = commitArrange(slides, { slideId: 'cards', elementIds: ['b'], to: 'front' });
    expect(layout(front)).toEqual(['a', 'c:g', 'b:g', 'd']);
    expect(
      commitArrange(front.slides, { slideId: 'cards', elementIds: ['b'], to: 'front' }).change,
    ).toBeNull();
  });

  it('drops a layer onto another of the same group, as a layers panel does', () => {
    const moved = commitMoveLayer(slides, { slideId: 'cards', layerId: 'g', overId: 'a' });
    expectReversible(slides, moved);
    expect(layout(moved)).toEqual(['b:g', 'c:g', 'a', 'd']);
    expect(moved.change?.kind).toBe('arrange');
    expect(moved.change?.after?.elementIds).toEqual(['b', 'c']);
    const top = commitMoveLayer(slides, { slideId: 'cards', layerId: 'a', overId: 'd' });
    expect(layout(top)).toEqual(['b:g', 'c:g', 'd', 'a']);
    const inside = commitMoveLayer(slides, { slideId: 'cards', layerId: 'c', overId: 'b' });
    expect(layout(inside)).toEqual(['a', 'c:g', 'b:g', 'd']);
  });

  it('does not move a layer into another group', () => {
    expect(
      commitMoveLayer(slides, { slideId: 'cards', layerId: 'b', overId: 'a' }).change,
    ).toBeNull();
  });
});

describe('copies and removal keep groups whole', () => {
  it('gives a group copied whole a new id and puts it above the original', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    const commit = commitDuplicate(slides, {
      slideId: 'cards',
      elementIds: ['a', 'b'],
      nextId: counter('copy'),
    });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['a:g', 'b:g', 'copy-1:copy-3', 'copy-2:copy-3', 'c']);
  });

  it('keeps a copy of part of a group in that group', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    const commit = commitDuplicate(slides, {
      slideId: 'cards',
      elementIds: ['a'],
      nextId: counter('copy'),
    });
    expect(layout(commit)).toEqual(['a:g', 'copy-1:g', 'b:g', 'c']);
  });

  it('pastes groups as new groups and a lone member as no group', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g'])])];
    const clipboard = [shape('x', ['g']), shape('y', ['g']), shape('z', ['h'])];
    const commit = commitPaste(slides, {
      slideId: 'cards',
      elements: clipboard,
      nextId: counter('paste'),
    });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['a:g', 'b:g', 'paste-1:paste-4', 'paste-2:paste-4', 'paste-3']);
  });

  it('dissolves a group left with one member after a removal', () => {
    const slides = [slideOf([shape('a', ['g']), shape('b', ['g']), shape('c')])];
    const commit = commitRemove(slides, { slideId: 'cards', elementIds: ['a'] });
    expectReversible(slides, commit);
    expect(layout(commit)).toEqual(['b', 'c']);
  });
});
