import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Box, Paragraph, SlideElement, SlideIr } from '@lct/contracts';
import {
  FONT_SIZE_PT,
  JOURNAL_LIMIT,
  commitInsert,
  commitMove,
  commitMoves,
  commitMoveGesture,
  commitRemove,
  commitSetColor,
  commitSetFontSize,
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
    lineSpacing: null,
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

function styledText(elementId: string): SlideElement {
  return {
    kind: 'text',
    elementId,
    role: 'title',
    box: { ...ORIGIN },
    sourceShapeId: null,
    paragraphs: [
      {
        level: 0,
        lineSpacing: null,
        runs: [
          { text: 'Hello', font: 'Face', sizePt: 32, bold: true, italic: false, color: '111111' },
          { text: ' there', font: 'Face', sizePt: 16, bold: null, italic: null, color: '222222' },
        ],
      },
      {
        level: 1,
        lineSpacing: null,
        runs: [{ text: 'More', font: '', sizePt: null, bold: null, italic: true, color: '' }],
      },
    ],
    overflow: null,
  };
}

function imageElement(elementId: string): SlideElement {
  return {
    kind: 'image',
    elementId,
    role: 'image',
    box: { ...ORIGIN },
    sourceShapeId: null,
    mediaPart: 'ppt/media/picture.png',
    fit: 'contain',
  };
}

function withRunSize(element: SlideElement, sizePt: number): SlideElement {
  if (element.kind !== 'text') throw new Error('not text');
  return {
    ...element,
    paragraphs: element.paragraphs.map((item) => ({
      ...item,
      runs: item.runs.map((run) => ({ ...run, sizePt })),
    })),
  };
}

function withRunColor(element: SlideElement, color: string): SlideElement {
  if (element.kind !== 'text') throw new Error('not text');
  return {
    ...element,
    paragraphs: element.paragraphs.map((item) => ({
      ...item,
      runs: item.runs.map((run) => ({ ...run, color })),
    })),
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

describe('remove', () => {
  it('removes several elements in one entry and undo puts them back in paint order', () => {
    const crowded = slide('opening', 0, [
      textElement('title', 'Opening', ORIGIN),
      textElement('note', 'Note', ORIGIN),
      textElement('footer', 'Footer', ORIGIN),
    ]);
    const slides = [crowded, ...deck().slice(1)];
    const commit = commitRemove(slides, { slideId: 'opening', elementIds: ['footer', 'title'] });

    expect(commit.change?.ops).toEqual([
      { op: 'remove', elementId: 'title' },
      { op: 'remove', elementId: 'footer' },
    ]);
    expect(commit.slides[0]?.elements.map((element) => element.elementId)).toEqual(['note']);
    const history = recordChange(createDeckHistory(slides), commit);
    expect(history.undo).toHaveLength(1);
    expect(undoDeck(history).slides).toEqual(slides);
    expect(slides[0]?.elements).toHaveLength(3);
  });

  it('leaves the deck untouched when no id belongs to that slide', () => {
    const slides = deck();
    const commit = commitRemove(slides, { slideId: 'opening', elementIds: ['body', 'missing'] });

    expect(commit.change).toBeNull();
    expect(commit.slides).toBe(slides);
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

describe('set-font-size', () => {
  it('records one set-font-size and updates every run', () => {
    const title = styledText('title');
    const note = textElement('note', 'Note', ORIGIN);
    const picture = imageElement('picture');
    const slides = [slide('opening', 0, [title, note, picture]), ...deck().slice(1)];
    const before = structuredClone(slides);
    const commit = commitSetFontSize(slides, {
      slideId: 'opening',
      elementId: 'title',
      sizePt: 18,
    });
    const opening = before[0];
    const original = opening?.elements[0];
    if (!original) throw new Error('missing element');

    expect(commit.change?.ops).toEqual([{ op: 'set-font-size', elementId: 'title', sizePt: 18 }]);
    expect(commit.change?.slideId).toBe('opening');
    expect(commit.slides[0]?.elements[0]).toEqual(withRunSize(original, 18));
    expect(commit.slides[0]?.elements[1]).toBe(note);
    expect(commit.slides[0]?.elements[2]).toBe(picture);
    expect(commit.slides[1]).toBe(slides[1]);
    expect(slides).toEqual(before);
    expect(Object.isFrozen(slides)).toBe(false);
    expect(Object.isFrozen(slides[0]?.elements[0]?.box)).toBe(false);

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(before);
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(before);
  });

  it('restores the copy from before the gesture even if that slide is edited afterwards', () => {
    const slides = deck();
    const commit = commitSetFontSize(slides, {
      slideId: 'opening',
      elementId: 'title',
      sizePt: 28,
    });
    const element = slides[0]?.elements[0];
    if (!element || element.kind !== 'text') throw new Error('missing text');
    const run = element.paragraphs[0]?.runs[0];
    if (!run) throw new Error('missing run');
    run.text = 'tampered';
    run.sizePt = 99;

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(deck());
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(deck());
  });

  it('does not change a slide when the element is not text or the size is not usable', () => {
    const picture = imageElement('picture');
    const images = [slide('opening', 0, [picture])];
    const nonText = commitSetFontSize(images, {
      slideId: 'opening',
      elementId: 'picture',
      sizePt: 14,
    });
    expect(nonText).toEqual({ slides: images, change: null });
    expect(nonText.slides).toBe(images);
    expect(Object.isFrozen(images)).toBe(false);
    expect(images[0]?.elements[0]).toBe(picture);

    const slides = deck();
    for (const sizePt of [0, -8, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const commit = commitSetFontSize(slides, {
        slideId: 'opening',
        elementId: 'title',
        sizePt,
      });
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
    const missing = commitSetFontSize(slides, {
      slideId: 'opening',
      elementId: 'missing',
      sizePt: 14,
    });
    const otherSlide = commitSetFontSize(slides, {
      slideId: 'middle',
      elementId: 'title',
      sizePt: 14,
    });
    const blank = slide('opening', 0, [
      {
        kind: 'text',
        elementId: 'title',
        role: 'body',
        box: { ...ORIGIN },
        sourceShapeId: null,
        paragraphs: [{ level: 0, lineSpacing: null, runs: [] }],
        overflow: null,
      },
    ]);
    const blankSlides = [blank];
    const noRuns = commitSetFontSize(blankSlides, {
      slideId: 'opening',
      elementId: 'title',
      sizePt: 14,
    });
    const ready = withRunSize(styledText('title'), 18);
    const readySlides = [slide('opening', 0, [ready])];
    const same = commitSetFontSize(readySlides, {
      slideId: 'opening',
      elementId: 'title',
      sizePt: 18,
    });

    expect(missing.slides).toBe(slides);
    expect(otherSlide.slides).toBe(slides);
    expect(noRuns.slides).toBe(blankSlides);
    expect(noRuns.change).toBeNull();
    expect(same.change).toBeNull();
    expect(same.slides).toBe(readySlides);
    expect(Object.isFrozen(slides)).toBe(false);
    expect(slides).toEqual(deck());
  });
});

describe('set-font-size beyond the scale', () => {
  it('takes any size in bounds, clamps the rest and rounds to hundredths', () => {
    const slides = deck();
    const sizesOf = (commit: ReturnType<typeof commitSetFontSize>) => {
      const element = commit.slides[0]?.elements[0];
      if (!element || element.kind !== 'text') throw new Error('missing text');
      return element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.sizePt));
    };
    for (const [asked, kept] of [
      [13.5, 13.5],
      [72.3333, 72.33],
      [0.2, FONT_SIZE_PT.min],
      [5000, FONT_SIZE_PT.max],
    ] as const) {
      const commit = commitSetFontSize(slides, {
        slideId: 'opening',
        elementId: 'title',
        sizePt: asked,
      });
      expect(commit.change?.ops).toEqual([
        { op: 'set-font-size', elementId: 'title', sizePt: kept },
      ]);
      expect(sizesOf(commit).every((size) => size === kept)).toBe(true);
    }
  });
});

describe('set-color', () => {
  it('records one set-color with the role and stores the hex on every run', () => {
    const title = styledText('title');
    const note = textElement('note', 'Note', ORIGIN);
    const slides = [slide('opening', 0, [title, note]), ...deck().slice(1)];
    const before = structuredClone(slides);
    const hex = 'AbCDeF';
    const commit = commitSetColor(slides, {
      slideId: 'opening',
      elementId: 'title',
      colorRole: 'accent',
      hex,
    });
    const original = before[0]?.elements[0];
    if (!original) throw new Error('missing element');

    expect(commit.change?.ops).toEqual([
      { op: 'set-color', elementId: 'title', colorRole: 'accent' },
    ]);
    expect(commit.change?.ops[0]).not.toHaveProperty('hex');
    expect(JSON.stringify(commit.change?.ops)).not.toContain(hex);
    expect(commit.change?.slideId).toBe('opening');
    expect(commit.slides[0]?.elements[0]).toEqual(withRunColor(original, hex));
    expect(commit.slides[0]?.elements[1]).toBe(note);
    expect(slides).toEqual(before);
    expect(Object.isFrozen(slides)).toBe(false);

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(before);
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(before);

    const lower = commitSetColor(commit.slides, {
      slideId: 'opening',
      elementId: 'title',
      colorRole: 'text',
      hex: 'abcdef',
    });
    expect(lower.change?.ops).toEqual([{ op: 'set-color', elementId: 'title', colorRole: 'text' }]);
    expect(lower.slides[0]?.elements[0]).toEqual(withRunColor(original, 'abcdef'));
  });

  it('takes a colour value: a role journals set-color, a hex a user chose does not', () => {
    const title = styledText('title');
    const slides = [slide('opening', 0, [title]), ...deck().slice(1)];
    const before = structuredClone(slides);
    const original = before[0]?.elements[0];
    if (!original) throw new Error('missing element');

    const role = commitSetColor(slides, {
      slideId: 'opening',
      elementId: 'title',
      color: 'accent',
      hex: '3355E0',
    });
    expect(role.change?.ops).toEqual([
      { op: 'set-color', elementId: 'title', colorRole: 'accent' },
    ]);
    expect(role.slides[0]?.elements[0]).toEqual(withRunColor(original, '3355E0'));

    // A hex is its own paint: the `hex` beside it cannot disagree with it.
    const own = commitSetColor(slides, {
      slideId: 'opening',
      elementId: 'title',
      color: '12ab9F',
      hex: '000000',
    });
    expect(own.change?.ops).toEqual([]);
    expect(own.change?.kind).toBe('color');
    expect(own.slides[0]?.elements[0]).toEqual(withRunColor(original, '12ab9F'));
    expect(replay(own.slides, own.change?.inversePatches ?? [])).toEqual(before);
    expect(undoDeck(recordChange(createDeckHistory(slides), own)).slides).toEqual(before);

    for (const color of ['#12ab9F', 'ultramarine', 'abc']) {
      const refused = commitSetColor(slides, {
        slideId: 'opening',
        elementId: 'title',
        color,
        hex: 'aabbcc',
      });
      expect(refused.change).toBeNull();
      expect(refused.slides).toBe(slides);
    }
  });

  it('restores the copy from before the gesture even if that slide is edited afterwards', () => {
    const slides = deck();
    const commit = commitSetColor(slides, {
      slideId: 'opening',
      elementId: 'title',
      colorRole: 'text-muted',
      hex: '010203',
    });
    const element = slides[0]?.elements[0];
    if (!element || element.kind !== 'text') throw new Error('missing text');
    const run = element.paragraphs[0]?.runs[0];
    if (!run) throw new Error('missing run');
    run.text = 'tampered';
    run.color = 'ffffff';

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(deck());
  });

  it('does not change a slide when the element is not text or the hex is not six digits', () => {
    const picture = imageElement('picture');
    const images = [slide('opening', 0, [picture])];
    const nonText = commitSetColor(images, {
      slideId: 'opening',
      elementId: 'picture',
      colorRole: 'accent',
      hex: 'aabbcc',
    });
    expect(nonText).toEqual({ slides: images, change: null });
    expect(nonText.slides).toBe(images);
    expect(images[0]?.elements[0]).toBe(picture);

    const slides = deck();
    for (const hex of ['#aabbcc', 'abc', 'aabbccdd', 'gggggg', '', 'aabbcc ']) {
      const commit = commitSetColor(slides, {
        slideId: 'opening',
        elementId: 'title',
        colorRole: 'accent',
        hex,
      });
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
    const blank = slide('opening', 0, [
      {
        kind: 'text',
        elementId: 'title',
        role: 'body',
        box: { ...ORIGIN },
        sourceShapeId: null,
        paragraphs: [{ level: 0, lineSpacing: null, runs: [] }],
        overflow: null,
      },
    ]);
    const blankSlides = [blank];
    const noRuns = commitSetColor(blankSlides, {
      slideId: 'opening',
      elementId: 'title',
      colorRole: 'text',
      hex: 'aabbcc',
    });
    const ready = withRunColor(styledText('title'), 'AbCDeF');
    const readySlides = [slide('opening', 0, [ready])];
    const same = commitSetColor(readySlides, {
      slideId: 'opening',
      elementId: 'title',
      colorRole: 'accent',
      hex: 'AbCDeF',
    });

    expect(noRuns.change).toBeNull();
    expect(noRuns.slides).toBe(blankSlides);
    expect(same.change).toBeNull();
    expect(same.slides).toBe(readySlides);
    expect(slides).toEqual(deck());
    expect(Object.isFrozen(slides)).toBe(false);
  });
});

describe('insert', () => {
  it('appends several elements in one entry and undo restores the paint order', () => {
    const slides = deck();
    const picture = imageElement('picture');
    const note = textElement('note', 'Note', ORIGIN);
    const rule: SlideElement = {
      kind: 'decor',
      elementId: 'rule',
      role: 'decoration',
      box: { ...ORIGIN },
      sourceShapeId: 4,
    };
    const commit = commitInsert(slides, {
      slideId: 'middle',
      elements: [picture, note, rule],
    });

    expect(commit.change?.ops).toEqual([]);
    expect(commit.change?.slideId).toBe('middle');
    expect(commit.slides[1]?.elements.map((element) => element.elementId)).toEqual([
      'body',
      'picture',
      'note',
      'rule',
    ]);
    expect(commit.slides[1]?.elements[1]).toEqual(picture);
    expect(commit.slides[1]?.elements[2]).toEqual(note);
    expect(commit.slides[1]?.elements[3]).toEqual(rule);
    expect(commit.slides[0]).toBe(slides[0]);
    expect(commit.slides[1]?.elements[0]).toBe(slides[1]?.elements[0]);
    expect(slides[1]?.elements).toHaveLength(1);
    expect(Object.isFrozen(slides)).toBe(false);

    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(slides);
    const history = recordChange(createDeckHistory(slides), commit);
    expect(history.undo).toHaveLength(1);
    expect(undoDeck(history).slides).toEqual(slides);
  });

  it('keeps the stored slide and the undo result when the caller edits the inserted element', () => {
    const slides = deck();
    const picture = imageElement('picture');
    const note = textElement('note', 'Note', ORIGIN);
    const commit = commitInsert(slides, { slideId: 'opening', elements: [picture, note] });
    if (picture.kind !== 'image') throw new Error('missing image');
    picture.box.x = 1;
    picture.mediaPart = 'tampered.png';
    if (note.kind !== 'text') throw new Error('missing text');
    const run = note.paragraphs[0]?.runs[0];
    if (!run) throw new Error('missing run');
    run.text = 'tampered';

    const storedPicture = commit.slides[0]?.elements[1];
    const storedNote = commit.slides[0]?.elements[2];
    expect(storedPicture).not.toBe(picture);
    expect(storedNote).not.toBe(note);
    expect(storedPicture).toMatchObject({ box: ORIGIN, mediaPart: 'ppt/media/picture.png' });
    expect(storedNote).toMatchObject({ paragraphs: [paragraph('Note')] });
    expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(deck());
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(deck());
    expect(slides).toEqual(deck());
  });

  it('leaves the deck untouched when the slide or the elements cannot be inserted', () => {
    const slides = deck();
    const empty = commitInsert(slides, { slideId: 'opening', elements: [] });
    const unknown = commitInsert(slides, {
      slideId: 'missing',
      elements: [textElement('note', 'Note', ORIGIN)],
    });
    const duplicate = commitInsert(slides, {
      slideId: 'opening',
      elements: [textElement('note', 'Note', ORIGIN), textElement('title', 'Again', ORIGIN)],
    });
    const invalid = commitInsert(slides, {
      slideId: 'opening',
      elements: [
        textElement('note', 'Note', ORIGIN),
        { kind: 'text', elementId: 'broken' } as SlideElement,
      ],
    });

    expect(empty).toEqual({ slides, change: null });
    expect(empty.slides).toBe(slides);
    expect(unknown.slides).toBe(slides);
    expect(unknown.change).toBeNull();
    expect(duplicate.slides).toBe(slides);
    expect(duplicate.change).toBeNull();
    expect(invalid.slides).toBe(slides);
    expect(invalid.change).toBeNull();
    expect(slides).toEqual(deck());
    expect(Object.isFrozen(slides)).toBe(false);
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

describe('overflow', () => {
  it('drops the overflow the engine measured for the old copy', () => {
    const base = textElement('title', 'Opening', ORIGIN);
    if (base.kind !== 'text') throw new Error('not text');
    const stale: SlideElement = { ...base, overflow: { lines: 2, emu: 20_000 } };
    const slides = [slide('opening', 0, [stale])];
    const commit = commitSetText(slides, {
      slideId: 'opening',
      elementId: 'title',
      paragraphs: [paragraph('Короче')],
    });

    expect(commit.slides[0]?.elements[0]).toMatchObject({ overflow: null });
    expect(undoDeck(recordChange(createDeckHistory(slides), commit)).slides).toEqual(slides);
  });
});

describe('folding a new text box into what was typed into it', () => {
  function empty(elementId: string): SlideElement {
    return {
      kind: 'text',
      elementId,
      role: 'body',
      box: { ...ORIGIN },
      sourceShapeId: null,
      paragraphs: [
        {
          level: 0,
          lineSpacing: null,
          runs: [{ text: '', font: '', sizePt: null, bold: null, italic: null, color: '' }],
        },
      ],
      overflow: null,
    };
  }

  it('marks an empty text box as pending and a filled one as an ordinary insert', () => {
    const slides = deck();
    expect(
      commitInsert(slides, { slideId: 'opening', elements: [empty('fresh')] }).change?.pendingText,
    ).toBe('fresh');
    expect(
      commitInsert(slides, {
        slideId: 'opening',
        elements: [textElement('fresh', 'Слово', ORIGIN)],
      }).change?.pendingText,
    ).toBeNull();
    expect(
      commitInsert(slides, { slideId: 'opening', elements: [empty('a'), empty('b')] }).change
        ?.pendingText,
    ).toBeNull();
  });

  it('takes the insert and the first words back in one undo', () => {
    const slides = deck();
    const inserted = recordChange(
      createDeckHistory(slides),
      commitInsert(slides, { slideId: 'opening', elements: [empty('fresh')] }),
    );
    const typed = recordChange(
      inserted,
      commitSetText(inserted.slides, {
        slideId: 'opening',
        elementId: 'fresh',
        paragraphs: [paragraph('Первые слова')],
      }),
    );

    expect(typed.undo).toHaveLength(1);
    expect(typed.undo[0]?.kind).toBe('insert');
    expect(typed.undo[0]?.ops.map((op) => op.op)).toEqual(['set-text']);
    expect(typed.undo[0]?.pendingText).toBeNull();
    expect(typed.slides[0]?.elements).toHaveLength(2);
    const undone = undoDeck(typed);
    expect(undone.slides).toEqual(slides);
    expect(redoDeck(undone).slides).toEqual(typed.slides);

    // A second session on the same element is a step of its own.
    const again = recordChange(
      typed,
      commitSetText(typed.slides, {
        slideId: 'opening',
        elementId: 'fresh',
        paragraphs: [paragraph('Другие слова')],
      }),
    );
    expect(again.undo).toHaveLength(2);
  });

  it('leaves no step at all when the new text box is removed unused', () => {
    const slides = deck();
    const inserted = recordChange(
      createDeckHistory(slides),
      commitInsert(slides, { slideId: 'opening', elements: [empty('fresh')] }),
    );
    const removed = recordChange(
      inserted,
      commitRemove(inserted.slides, { slideId: 'opening', elementIds: ['fresh'] }),
    );

    expect(removed.undo).toEqual([]);
    expect(removed.slides).toEqual(slides);
  });

  it('folds two changes into one when the caller asks', () => {
    const slides = deck();
    const first = recordChange(
      createDeckHistory(slides),
      commitMove(slides, {
        slideId: 'opening',
        elementId: 'title',
        box: { x: 10, y: 20, cx: 30, cy: 40 },
      }),
    );
    const merged = recordChange(
      first,
      commitSetText(first.slides, {
        slideId: 'opening',
        elementId: 'title',
        paragraphs: [paragraph('rewritten')],
      }),
      { merge: true },
    );

    expect(merged.undo).toHaveLength(1);
    expect(merged.undo[0]?.kind).toBe('move');
    expect(merged.undo[0]?.ops.map((op) => op.op)).toEqual(['move', 'set-text']);
    expect(undoDeck(merged).slides).toEqual(slides);
    expect(redoDeck(undoDeck(merged)).slides).toEqual(merged.slides);
  });
});

describe('series of changes', () => {
  const nudge = (history: ReturnType<typeof createDeckHistory>, x: number, series?: string) =>
    recordChange(
      history,
      commitMove(history.slides, {
        slideId: 'opening',
        elementId: 'title',
        box: { ...ORIGIN, x },
      }),
      series === undefined ? undefined : { series },
    );

  it('folds a run of the same series into one step', () => {
    const slides = deck();
    let history = createDeckHistory(slides);
    for (const x of [1, 2, 3, 4]) history = nudge(history, x, 'nudge-a');

    expect(history.undo).toHaveLength(1);
    expect(history.undo[0]?.series).toBe('nudge-a');
    expect(undoDeck(history).slides).toEqual(slides);
  });

  it('starts a new step for another series or after any other change', () => {
    const slides = deck();
    let history = nudge(createDeckHistory(slides), 1, 'nudge-a');
    history = nudge(history, 2, 'nudge-b');
    expect(history.undo).toHaveLength(2);

    history = nudge(history, 3);
    history = nudge(history, 4, 'nudge-b');
    expect(history.undo).toHaveLength(4);
  });

  it('does not continue a series that undo already took back', () => {
    const slides = deck();
    const first = nudge(createDeckHistory(slides), 1, 'nudge-a');
    const again = nudge(undoDeck(first), 2, 'nudge-a');

    expect(again.undo).toHaveLength(1);
    expect(undoDeck(again).slides).toEqual(slides);
  });
});

describe('journal length', () => {
  it(`keeps the newest ${JOURNAL_LIMIT} steps and drops the oldest`, () => {
    const slides = deck();
    let history = createDeckHistory(slides);
    for (let step = 1; step <= JOURNAL_LIMIT + 5; step += 1) {
      history = recordChange(
        history,
        commitMove(history.slides, {
          slideId: 'opening',
          elementId: 'title',
          box: { ...ORIGIN, x: step },
        }),
      );
    }

    expect(history.undo).toHaveLength(JOURNAL_LIMIT);
    let undone = history;
    for (let step = 0; step < JOURNAL_LIMIT; step += 1) undone = undoDeck(undone);
    // The five oldest steps are gone: undo stops at the sixth move, not at the start.
    const title = undone.slides[0]?.elements.find((element) => element.elementId === 'title');
    expect(title?.box.x).toBe(5);
    expect(undoDeck(undone)).toBe(undone);
  });
});

describe('selection around undo', () => {
  it('brings back what was selected before a change, and what it left behind', () => {
    const slides = deck();
    const removed = recordChange(
      createDeckHistory(slides),
      commitRemove(slides, { slideId: 'opening', elementIds: ['title'] }),
    );
    expect(removed.restored).toBeNull();

    const undone = undoDeck(removed);
    expect(undone.restored).toEqual({ slideId: 'opening', elementIds: ['title'] });
    expect(redoDeck(undone).restored).toEqual({ slideId: 'opening', elementIds: [] });
  });

  it('takes the selection the caller states instead of the one the change guessed', () => {
    const slides = deck();
    const commit = commitMove(slides, {
      slideId: 'opening',
      elementId: 'title',
      box: { x: 10, y: 20, cx: 30, cy: 40 },
    });
    const history = recordChange(createDeckHistory(slides), commit, {
      before: { slideId: 'opening', elementIds: ['title', 'other'] },
    });
    expect(undoDeck(history).restored).toEqual({
      slideId: 'opening',
      elementIds: ['title', 'other'],
    });
  });

  it('clears the restored selection as soon as anything else is recorded', () => {
    const slides = deck();
    const history = undoDeck(
      recordChange(
        createDeckHistory(slides),
        commitRemove(slides, { slideId: 'opening', elementIds: ['title'] }),
      ),
    );
    expect(history.restored).not.toBeNull();
    const next = recordChange(
      history,
      commitMove(history.slides, {
        slideId: 'opening',
        elementId: 'title',
        box: { x: 1, y: 2, cx: 3, cy: 4 },
      }),
    );
    expect(next.restored).toBeNull();
  });
});
