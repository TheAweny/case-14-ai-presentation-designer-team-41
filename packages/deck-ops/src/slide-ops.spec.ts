import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { slideIrSchema, type SlideElement, type SlideIr } from '@lct/contracts';
import type { DeckCommit } from './core.js';
import { createDeckHistory, recordChange, redoDeck, undoDeck } from './journal.js';
import {
  commitDuplicateSlide,
  commitInsertSlide,
  commitRemoveSlide,
  commitSlideBackground,
} from './slide-ops.js';

function text(elementId: string): SlideElement {
  return {
    kind: 'text',
    elementId,
    role: 'body',
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [
      {
        level: 0,
        lineSpacing: null,
        runs: [{ text: 'Текст', font: '', sizePt: 16, bold: null, italic: null, color: '' }],
      },
    ],
    overflow: null,
  };
}

function slide(slideId: string, index: number): SlideIr {
  return {
    schemaVersion: 1,
    slideId,
    variant: 'balanced',
    index,
    patternId: 'pattern',
    slideCx: 12_192_000,
    slideCy: 6_858_000,
    elements: [text(`${slideId}-body`)],
  };
}

function deck(): SlideIr[] {
  return [slide('opening', 0), slide('middle', 1), slide('closing', 2)];
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

describe('insert slide', () => {
  it('puts a slide at an index and numbers the deck again', () => {
    const slides = deck();
    const commit = commitInsertSlide(slides, { index: 1, slide: slide('fresh', 99) });
    expectReversible(slides, commit);
    expect(commit.slides.map((item) => item.slideId)).toEqual([
      'opening',
      'fresh',
      'middle',
      'closing',
    ]);
    expect(commit.slides.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(commit.change?.kind).toBe('slide-insert');
    expect(commit.change?.slideId).toBeNull();
    expect(commit.change?.after?.slideId).toBe('fresh');
    expect(commit.change?.before?.slideId).toBe('opening');
    expect(commit.slides).toHaveLength(4);
    expect(slides).toHaveLength(3);
  });

  it('appends at the end and refuses an index, an id or a slide it cannot take', () => {
    const slides = deck();
    expect(
      commitInsertSlide(slides, { index: 3, slide: slide('fresh', 0) }).slides.map(
        (item) => item.slideId,
      ),
    ).toEqual(['opening', 'middle', 'closing', 'fresh']);
    for (const commit of [
      commitInsertSlide(slides, { index: 4, slide: slide('fresh', 0) }),
      commitInsertSlide(slides, { index: -1, slide: slide('fresh', 0) }),
      commitInsertSlide(slides, { index: 1.5, slide: slide('fresh', 0) }),
      commitInsertSlide(slides, { index: 1, slide: slide('middle', 0) }),
      commitInsertSlide(slides, { index: 1, slide: { ...slide('fresh', 0), patternId: '' } }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });
});

describe('duplicate slide', () => {
  it('copies a slide right after it with a new id and the same elements', () => {
    const slides = deck();
    const commit = commitDuplicateSlide(slides, { slideId: 'middle', nextId: () => 'middle-copy' });
    expectReversible(slides, commit);
    expect(commit.slides.map((item) => item.slideId)).toEqual([
      'opening',
      'middle',
      'middle-copy',
      'closing',
    ]);
    expect(commit.slides.map((item) => item.index)).toEqual([0, 1, 2, 3]);
    expect(commit.slides[2]?.elements).toEqual(slides[1]?.elements);
    expect(commit.slides[2]?.elements[0]).not.toBe(slides[1]?.elements[0]);
    expect(commit.change?.kind).toBe('slide-duplicate');
    expect(commit.change?.after?.slideId).toBe('middle-copy');
  });

  it('takes the id it is given, unless the deck has it already', () => {
    const slides = deck();
    expect(
      commitDuplicateSlide(slides, { slideId: 'opening', newSlideId: 'named' }).slides[1]?.slideId,
    ).toBe('named');
    expect(
      commitDuplicateSlide(slides, {
        slideId: 'opening',
        newSlideId: 'closing',
        nextId: () => 'instead',
      }).slides[1]?.slideId,
    ).toBe('instead');
    const missing = commitDuplicateSlide(slides, { slideId: 'nowhere' });
    expect(missing.change).toBeNull();
    expect(missing.slides).toBe(slides);
  });
});

describe('remove slide', () => {
  it('removes a slide, numbers the rest again and selects a neighbour', () => {
    const slides = deck();
    const commit = commitRemoveSlide(slides, { slideId: 'middle' });
    expectReversible(slides, commit);
    expect(commit.slides.map((item) => item.slideId)).toEqual(['opening', 'closing']);
    expect(commit.slides.map((item) => item.index)).toEqual([0, 1]);
    expect(commit.change?.after?.slideId).toBe('closing');
    expect(commitRemoveSlide(slides, { slideId: 'closing' }).change?.after?.slideId).toBe('middle');
  });

  it('keeps the last slide of a deck and ignores an unknown id', () => {
    const one = [slide('only', 0)];
    const last = commitRemoveSlide(one, { slideId: 'only' });
    expect(last.change).toBeNull();
    expect(last.slides).toBe(one);
    const slides = deck();
    const missing = commitRemoveSlide(slides, { slideId: 'nowhere' });
    expect(missing.change).toBeNull();
    expect(missing.slides).toBe(slides);
  });
});

describe('slide background', () => {
  it('fills a slide with a role and takes it back to the template background', () => {
    const slides = deck();
    const filled = commitSlideBackground(slides, { slideId: 'middle', background: 'surface' });
    expectReversible(slides, filled);
    expect(filled.slides[1]?.background).toBe('surface');
    expect(filled.change?.kind).toBe('slide-background');
    expect(filled.change?.slideId).toBe('middle');

    const cleared = commitSlideBackground(filled.slides, { slideId: 'middle', background: null });
    expect(cleared.slides[1]).not.toHaveProperty('background');
    expect(cleared.slides).toEqual(slides);
    expect(
      redoDeck(undoDeck(recordChange(createDeckHistory(filled.slides), cleared))).slides,
    ).toEqual(cleared.slides);
  });

  it('fills a slide with a hex a user chose', () => {
    const slides = deck();
    const filled = commitSlideBackground(slides, { slideId: 'middle', background: '1E2a3B' });
    expectReversible(slides, filled);
    expect(filled.slides[1]?.background).toBe('1E2a3B');
    expect(filled.change?.ops).toEqual([]);
  });

  it('ignores a colour that is neither a role nor six hex digits, a missing slide and a value already set', () => {
    const slides = deck();
    for (const commit of [
      commitSlideBackground(slides, { slideId: 'middle', background: '#3355E0' }),
      commitSlideBackground(slides, { slideId: 'middle', background: 'ultramarine' }),
      commitSlideBackground(slides, { slideId: 'middle', background: '35E' }),
      commitSlideBackground(slides, { slideId: 'nowhere', background: 'accent' }),
      commitSlideBackground(slides, { slideId: 'middle', background: null }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });
});
