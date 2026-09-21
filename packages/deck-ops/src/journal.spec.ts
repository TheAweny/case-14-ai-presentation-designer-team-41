import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Box, Paragraph, SlideElement, SlideIr } from '@lct/contracts';
import {
  commitMove,
  commitMoves,
  commitMoveGesture,
  commitSetText,
  commitSetTextGesture,
  createDeckHistory,
  recordChange,
  redoDeck,
  reorderSlides,
  undoDeck,
} from './journal.js';

function paragraph(text: string): Paragraph {
  return {
    level: 0,
    runs: [{ text, font: '', sizePt: null, bold: null, italic: null, color: '' }],
  };
}

function textElement(elementId: string, text: string, box: Box): SlideElement {
  return {
    kind: 'text',
    elementId,
    role: 'body',
    box: { ...box },
    sourceShapeId: null,
    paragraphs: [paragraph(text)],
    overflow: null,
  };
}

function slide(slideId: string, index: number, elements: readonly SlideElement[]): SlideIr {
  return {
    schemaVersion: 1,
    slideId,
    variant: 'balanced',
    index,
    patternId: 'pattern',
    slideCx: 12_192_000,
    slideCy: 6_858_000,
    elements: [...elements],
  };
}

const ORIGIN: Box = { x: 100_000, y: 200_000, cx: 3_000_000, cy: 800_000 };

function deck(): SlideIr[] {
  return [
    slide('opening', 0, [textElement('title', 'Opening', ORIGIN)]),
    slide('middle', 1, [textElement('body', 'Middle', ORIGIN)]),
    slide('closing', 2, [textElement('close', 'Closing', ORIGIN)]),
  ];
}

function replay(slides: readonly SlideIr[], patches: readonly Patch[]): readonly SlideIr[] {
  return applyPatches(slides as SlideIr[], [...patches]);
}

describe('move', () => {
  it('restores the original slide when the inverse patch is applied', () => {
    const slides = deck();
    const box: Box = { x: 400_000, y: 500_000, cx: 2_000_000, cy: 600_000 };
    const commit = commitMove(slides, { slideId: 'opening', elementId: 'title', box });

    expect(commit.change).not.toBeNull();
    expect(replay(slides, commit.change?.patches ?? [])).toEqual(commit.slides);
    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(slides);
    expect(slides[0]?.elements[0]).toMatchObject({ box: ORIGIN });
  });

  it('records one move for a whole drag, not one op per sample', () => {
    const slides = deck();
    const samples = Array.from({ length: 24 }, (_, step) => ({
      x: 100_000 + (step + 1) * 10_000,
      y: 200_000 + (step + 1) * 1_000,
      cx: 3_000_000,
      cy: 800_000,
    }));
    const commit = commitMoveGesture(slides, {
      slideId: 'opening',
      elementId: 'title',
      samples,
    });
    const finalBox = samples[samples.length - 1];

    expect(commit.change?.ops).toEqual([{ op: 'move', elementId: 'title', box: finalBox }]);
    expect(commit.change?.patches.length).toBeLessThan(samples.length);
    expect(JSON.stringify(commit.change?.patches)).not.toContain(String(samples[0]?.x));
    expect(commit.slides[0]?.elements[0]).toMatchObject({ box: finalBox });

    const history = recordChange(createDeckHistory(slides), commit);
    expect(history.undo).toHaveLength(1);
    expect(undoDeck(history).slides).toEqual(slides);
  });

  it('leaves the deck untouched when the element id belongs to no element of that slide', () => {
    const slides = deck();
    const box: Box = { x: 1, y: 2, cx: 3, cy: 4 };
    const missing = commitMove(slides, { slideId: 'opening', elementId: 'missing', box });
    const otherSlide = commitMove(slides, { slideId: 'middle', elementId: 'title', box });

    expect(missing).toEqual({ slides, change: null });
    expect(otherSlide).toEqual({ slides, change: null });
    expect(missing.slides).toBe(slides);
    expect(Object.isFrozen(slides)).toBe(false);
    expect(Object.isFrozen(slides[0]?.elements[0]?.box)).toBe(false);
    expect(slides).toEqual(deck());
  });

  it('restores the box from before the gesture even if that slide is edited afterwards', () => {
    const slides = deck();
    const box: Box = { x: 400_000, y: 500_000, cx: 2_000_000, cy: 600_000 };
    const commit = commitMove(slides, { slideId: 'opening', elementId: 'title', box });
    const element = slides[0]?.elements[0];
    if (!element) throw new Error('missing element');
    element.box.x = 1;

    expect(
      replay(commit.slides, commit.change?.inversePatches ?? [])[0]?.elements[0],
    ).toMatchObject({ box: ORIGIN });
    expect(
      undoDeck(recordChange(createDeckHistory(slides), commit)).slides[0]?.elements[0],
    ).toMatchObject({ box: ORIGIN });
  });
});

describe('group move', () => {
  it('records every element of one gesture in a single journal entry', () => {
    const slides = deck();
    const commit = commitMoves(slides, {
      slideId: 'opening',
      moves: [
        { elementId: 'title', box: { x: 10, y: 20, cx: 30, cy: 40 } },
        { elementId: 'missing', box: { x: 1, y: 2, cx: 3, cy: 4 } },
        { elementId: 'title', box: { x: 11, y: 21, cx: 31, cy: 41 } },
      ],
    });
    const second = slide('opening', 0, [
      textElement('title', 'Opening', ORIGIN),
      textElement('note', 'Note', ORIGIN),
    ]);
    const group = commitMoves([second, ...slides.slice(1)], {
      slideId: 'opening',
      moves: [
        { elementId: 'title', box: { x: 5, y: 6, cx: 7, cy: 8 } },
        { elementId: 'note', box: { x: 9, y: 10, cx: 11, cy: 12 } },
      ],
    });

    expect(commit.change?.ops).toEqual([
      { op: 'move', elementId: 'title', box: { x: 11, y: 21, cx: 31, cy: 41 } },
    ]);
    expect(group.change?.ops).toHaveLength(2);
    const history = recordChange(createDeckHistory([second, ...slides.slice(1)]), group);
    expect(history.undo).toHaveLength(1);
    expect(undoDeck(history).slides[0]?.elements.map((element) => element.box)).toEqual([
      ORIGIN,
      ORIGIN,
    ]);
    expect(Object.isFrozen(slides)).toBe(false);
  });
});

describe('set-text', () => {
  it('records one set-text for a whole editing session, not one op per character', () => {
    const slides = deck();
    const drafts = ['one', 'two', 'three', 'four'].map((text) => [paragraph(text)]);
    const commit = commitSetTextGesture(slides, {
      slideId: 'opening',
      elementId: 'title',
      drafts,
    });

    expect(commit.change?.ops).toHaveLength(1);
    expect(commit.change?.ops[0]).toMatchObject({
      op: 'set-text',
      elementId: 'title',
      paragraphs: drafts[3],
    });
    expect(commit.change?.patches.length).toBeLessThan(drafts.length);
    expect(JSON.stringify(commit.change?.patches)).not.toContain('two');
    expect(commit.slides[0]?.elements[0]).toMatchObject({ paragraphs: drafts[3] });

    const restored = replay(commit.slides, commit.change?.inversePatches ?? []);
    expect(restored).toEqual(slides);
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(slides);
  });

  it('does not change a slide when the element is not a text element', () => {
    const image: SlideElement = {
      kind: 'image',
      elementId: 'picture',
      role: 'image',
      box: ORIGIN,
      sourceShapeId: null,
      mediaPart: 'ppt/media/picture.png',
      fit: 'contain',
    };
    const slides = [slide('opening', 0, [image])];
    const commit = commitSetText(slides, {
      slideId: 'opening',
      elementId: 'picture',
      paragraphs: [paragraph('caption')],
    });

    expect(commit).toEqual({ slides, change: null });
    expect(Object.isFrozen(slides)).toBe(false);
    expect(slides[0]?.elements[0]).toEqual(image);
  });

  it('restores the copy from before the gesture even if that slide is edited afterwards', () => {
    const slides = deck();
    const commit = commitSetText(slides, {
      slideId: 'opening',
      elementId: 'title',
      paragraphs: [paragraph('rewritten')],
    });
    const element = slides[0]?.elements[0];
    if (!element || element.kind !== 'text') throw new Error('missing text');
    const run = element.paragraphs[0]?.runs[0];
    if (!run) throw new Error('missing run');
    run.text = 'tampered';

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(deck());
  });
});

describe('reorder', () => {
  it('moves a slide without an engine op and undoes back to the original order', () => {
    const slides = deck();
    const commit = reorderSlides(slides, 0, 2);

    expect(commit.change?.ops).toEqual([]);
    expect(commit.change?.slideId).toBeNull();
    expect(commit.slides.map((item) => item.slideId)).toEqual(['middle', 'closing', 'opening']);
    expect(commit.slides.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(slides);

    const opening = slides[0];
    if (!opening) throw new Error('missing slide');
    opening.slideId = 'tampered';
    opening.index = 99;

    const restored = replay(commit.slides, commit.change?.inversePatches ?? []);
    expect(restored.map((item) => item.slideId)).toEqual(['opening', 'middle', 'closing']);
    expect(restored.map((item) => item.index)).toEqual([0, 1, 2]);

    const fresh = deck();
    const again = reorderSlides(fresh, 0, 2);
    const undone = undoDeck(recordChange(createDeckHistory(fresh), again));
    expect(undone.slides).toEqual(fresh);
    expect(redoDeck(undone).slides).toEqual(again.slides);
  });
});

describe('history', () => {
  it('treats two gestures as two entries and drops redo when a new gesture is recorded', () => {
    const slides = deck();
    const first = commitMove(slides, {
      slideId: 'opening',
      elementId: 'title',
      box: { x: 10, y: 20, cx: 30, cy: 40 },
    });
    const second = commitSetText(first.slides, {
      slideId: 'opening',
      elementId: 'title',
      paragraphs: [paragraph('rewritten')],
    });
    const history = recordChange(recordChange(createDeckHistory(slides), first), second);

    expect(history.undo).toHaveLength(2);
    expect(history.undo[0]?.ops.map((op) => op.op)).toEqual(['move']);
    expect(history.undo[1]?.ops.map((op) => op.op)).toEqual(['set-text']);

    const once = undoDeck(history);
    const twice = undoDeck(once);
    expect(twice.slides).toEqual(slides);
    expect(twice.redo).toHaveLength(2);

    const branched = recordChange(
      once,
      commitMove(once.slides, {
        slideId: 'middle',
        elementId: 'body',
        box: { x: 5, y: 6, cx: 7, cy: 8 },
      }),
    );
    expect(branched.redo).toEqual([]);
    expect(undoDeck(branched).slides[0]).toEqual(first.slides[0]);
  });
});
