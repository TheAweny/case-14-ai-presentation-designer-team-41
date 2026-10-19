import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { slideIrSchema, type Box, type SlideElement, type SlideIr } from '@lct/contracts';
import {
  ELEMENT_PROPS,
  LETTER_SPACING_PT,
  LINE_SPACING,
  commitArrange,
  commitChartAxes,
  commitChartData,
  commitDuplicate,
  commitElementProps,
  commitInsertTableColumn,
  commitInsertTableRow,
  commitPaste,
  commitRemoveTableColumn,
  commitRemoveTableRow,
  commitReplaceImage,
  commitTableCell,
} from './element-ops.js';
import { createDeckHistory, recordChange, undoDeck } from './journal.js';
import type { DeckCommit } from './core.js';

const ORIGIN: Box = { x: 100_000, y: 200_000, cx: 3_000_000, cy: 800_000 };

function text(elementId: string, words = 'Слово'): SlideElement {
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
        runs: [
          { text: words, font: '', sizePt: 16, bold: null, italic: null, color: '' },
          { text: '!', font: '', sizePt: 16, bold: true, italic: null, color: '' },
        ],
      },
    ],
    overflow: { lines: 1, emu: 1000 },
  };
}

function decor(elementId: string): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: { ...ORIGIN },
    sourceShapeId: null,
    shape: 'rect',
    fill: 'accent',
    stroke: null,
  };
}

function picture(elementId: string): SlideElement {
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

function table(elementId: string): SlideElement {
  return {
    kind: 'table',
    elementId,
    role: 'table',
    box: { ...ORIGIN },
    sourceShapeId: null,
    headers: ['Этап', 'Где'],
    rows: [
      ['Разбор', 'Python'],
      ['План', 'TypeScript'],
    ],
  };
}

function chart(elementId: string): SlideElement {
  return {
    kind: 'chart',
    elementId,
    role: 'chart',
    box: { ...ORIGIN },
    sourceShapeId: null,
    chartType: 'column',
    categories: ['А', 'Б'],
    series: [{ name: 'Первая', values: [1, 2] }],
    xTitle: '',
    yTitle: '',
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

function deck(): SlideIr[] {
  return [
    slide('opening', 0, [text('title'), decor('panel'), picture('photo')]),
    slide('middle', 1, [table('grid'), chart('plot'), text('note', 'Заметка')]),
  ];
}

function replay(slides: readonly SlideIr[], patches: readonly Patch[]): readonly SlideIr[] {
  return applyPatches(slides as SlideIr[], [...patches]);
}

/** Applied, then undone: the deck is what it was, and the entry is a single step of history. */
function expectReversible(before: readonly SlideIr[], commit: DeckCommit): void {
  expect(commit.change).not.toBeNull();
  expect(commit.slides).not.toBe(before);
  for (const item of commit.slides) expect(slideIrSchema.parse(item)).toEqual(item);
  expect(replay(before, commit.change?.patches ?? [])).toEqual(commit.slides);
  expect(replay(commit.slides, commit.change?.inversePatches ?? [])).toEqual(before);
  const history = recordChange(createDeckHistory(before), commit);
  expect(history.undo).toHaveLength(1);
  expect(undoDeck(history).slides).toEqual(before);
  expect(Object.isFrozen(before)).toBe(false);
}

function elementOf(slides: readonly SlideIr[], slideId: string, elementId: string) {
  return slides
    .find((item) => item.slideId === slideId)
    ?.elements.find((item) => item.elementId === elementId);
}

describe('element properties', () => {
  it('sets the look of a shape and leaves it reversible', () => {
    const slides = deck();
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: {
        shape: 'round-rect',
        fill: 'accent-alt',
        stroke: { color: 'line', widthEmu: 25_400, dash: 'dash', head: 'none', tail: 'none' },
        cornerRadius: 0.25,
        rotation: 375,
        opacity: 0.5,
        flipH: true,
      },
    });
    expectReversible(slides, commit);
    expect(elementOf(commit.slides, 'opening', 'panel')).toMatchObject({
      shape: 'round-rect',
      fill: 'accent-alt',
      cornerRadius: 0.25,
      // 375 degrees is 15 degrees, so two ways of asking for the same angle compare equal.
      rotation: 15,
      opacity: 0.5,
      flipH: true,
      stroke: { color: 'line', widthEmu: 25_400, dash: 'dash' },
    });
    expect(commit.change?.kind).toBe('style');
    // The engine knows how to set a colour, so the entry carries that op and nothing else.
    expect(commit.change?.ops).toEqual([
      { op: 'set-color', elementId: 'panel', colorRole: 'accent-alt' },
    ]);
  });

  it('drops the outline read from the file when a shape is named', () => {
    const outline = {
      width: 10,
      height: 10,
      paths: [{ d: 'M0 0 L10 5 L0 10 Z', filled: true, stroked: true }],
    };
    const freeform: SlideElement = {
      kind: 'decor',
      elementId: 'panel',
      role: 'decoration',
      box: { ...ORIGIN },
      sourceShapeId: 20,
      geometry: outline,
      fill: 'accent',
      stroke: null,
    };
    const slides = [slide('opening', 0, [freeform])];
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { shape: 'ellipse' },
    });
    expectReversible(slides, commit);
    const panel = elementOf(commit.slides, 'opening', 'panel');
    expect(panel).toMatchObject({ shape: 'ellipse' });
    expect(panel).not.toHaveProperty('geometry');

    // Any other change keeps the outline.
    const filled = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { fill: 'surface' },
    });
    expect(elementOf(filled.slides, 'opening', 'panel')).toMatchObject({ geometry: outline });
  });

  it('merges a stroke over the one a shape already has', () => {
    const slides = [
      slide('opening', 0, [
        {
          ...decor('panel'),
          stroke: { color: 'accent', widthEmu: 12_700, dash: 'solid', head: 'none', tail: 'none' },
        } as SlideElement,
      ]),
    ];
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { stroke: { widthEmu: 38_100.4 } },
    });
    expectReversible(slides, commit);
    expect(elementOf(commit.slides, 'opening', 'panel')).toMatchObject({
      stroke: { color: 'accent', widthEmu: 38_100, dash: 'solid' },
    });

    // A shape with no stroke cannot take half of one.
    const bare = deck();
    expect(
      commitElementProps(bare, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { stroke: { widthEmu: 12_700 } },
      }).change,
    ).toBeNull();
  });

  it('drops a property that is back at its default instead of writing it out', () => {
    const slides = deck();
    const turned = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { rotation: 30, locked: true, opacity: 0.4 },
    });
    const back = commitElementProps(turned.slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { rotation: 360, locked: false, opacity: 1 },
    });
    const element = elementOf(back.slides, 'opening', 'panel');
    expect(element).not.toHaveProperty('rotation');
    expect(element).not.toHaveProperty('locked');
    expect(element).not.toHaveProperty('opacity');
    expect(back.change?.kind).toBe('style');
    expect(undoDeck(recordChange(createDeckHistory(turned.slides), back)).slides).toEqual(
      turned.slides,
    );
  });

  it('names a change of rotation alone and a change of the lock alone', () => {
    const slides = deck();
    expect(
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { rotation: 10 },
      }).change?.kind,
    ).toBe('rotate');
    expect(
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { locked: true },
      }).change?.kind,
    ).toBe('lock');
  });

  it('styles a mixed selection, each kind by what applies to it', () => {
    const slides = deck();
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['title', 'panel', 'photo'],
      props: { opacity: 0.5, fit: 'cover', bold: true, align: 'center', fill: 'negative' },
    });
    expectReversible(slides, commit);
    const title = elementOf(commit.slides, 'opening', 'title');
    expect(title).toMatchObject({ opacity: 0.5 });
    expect(title).not.toHaveProperty('fit');
    if (title?.kind !== 'text') throw new Error('not text');
    expect(title.paragraphs[0]?.align).toBe('center');
    expect(title.paragraphs[0]?.runs.every((run) => run.bold === true)).toBe(true);
    expect(elementOf(commit.slides, 'opening', 'photo')).toMatchObject({
      fit: 'cover',
      opacity: 0.5,
    });
    expect(elementOf(commit.slides, 'opening', 'panel')).toMatchObject({
      fill: 'negative',
      opacity: 0.5,
    });
    // A picture takes no paragraphs, and only the text produced an engine op.
    expect(commit.change?.ops.map((op) => op.op)).toEqual(['set-text', 'set-color']);
  });

  it('underlines every run and takes it back with null', () => {
    const slides = deck();
    const on = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { underline: true },
    });
    const off = commitElementProps(on.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { underline: null },
    });
    const first = elementOf(on.slides, 'opening', 'title');
    if (first?.kind !== 'text') throw new Error('not text');
    expect(first.paragraphs[0]?.runs.every((run) => run.underline === true)).toBe(true);
    const back = elementOf(off.slides, 'opening', 'title');
    if (back?.kind !== 'text') throw new Error('not text');
    expect(back.paragraphs[0]?.runs.some((run) => 'underline' in run)).toBe(false);
    expect(off.slides).toEqual(slides);
  });

  it('leaves the deck alone for an id on another slide, an unknown id or a value it refuses', () => {
    const slides = deck();
    for (const commit of [
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['note'],
        props: { opacity: 0.5 },
      }),
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['nobody'],
        props: { locked: true },
      }),
      commitElementProps(slides, {
        slideId: 'nowhere',
        elementIds: ['panel'],
        props: { locked: true },
      }),
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { rotation: Number.NaN, opacity: Number.POSITIVE_INFINITY },
      }),
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { shape: 'blob' as never, fill: 'ultramarine' as never },
      }),
      commitElementProps(slides, { slideId: 'opening', elementIds: [], props: { locked: true } }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
    expect(slides).toEqual(deck());
  });

  it('fills and outlines a shape with a hex a user chose, with no engine op for it', () => {
    const slides = deck();
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: {
        fill: '1a2B3c',
        stroke: { color: 'FF8800', widthEmu: 12_700, dash: 'solid', head: 'none', tail: 'none' },
      },
    });
    expectReversible(slides, commit);
    expect(elementOf(commit.slides, 'opening', 'panel')).toMatchObject({
      fill: '1a2B3c',
      stroke: { color: 'FF8800' },
    });
    // The engine only knows roles; a hex travels with the slide.
    expect(commit.change?.ops).toEqual([]);

    // Back to a role: the engine hears about it again.
    const role = commitElementProps(commit.slides, {
      slideId: 'opening',
      elementIds: ['panel'],
      props: { fill: 'surface', stroke: { color: 'line' } },
    });
    expectReversible(commit.slides, role);
    expect(elementOf(role.slides, 'opening', 'panel')).toMatchObject({
      fill: 'surface',
      stroke: { color: 'line' },
    });
    expect(role.change?.ops).toEqual([
      { op: 'set-color', elementId: 'panel', colorRole: 'surface' },
    ]);

    // Neither a hash, three digits nor a stray word is a colour.
    for (const fill of ['#1A2B3C', 'ABC', 'ultramarine']) {
      const refused = commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: { fill: fill as never },
      });
      expect(refused.change).toBeNull();
    }
    expect(
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['panel'],
        props: {
          stroke: { color: '#FF8800', widthEmu: 12_700, dash: 'solid', head: 'none', tail: 'none' },
        },
      }).change,
    ).toBeNull();
  });

  it('sets the face of every run and takes it back with null', () => {
    const slides = deck();
    const set = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { fontFamily: '  PT Serif ' },
    });
    expectReversible(slides, set);
    const title = elementOf(set.slides, 'opening', 'title');
    if (title?.kind !== 'text') throw new Error('not text');
    expect(title.paragraphs[0]?.runs.map((run) => run.font)).toEqual(['PT Serif', 'PT Serif']);
    expect(set.change?.kind).toBe('style');
    expect(set.change?.ops.map((op) => op.op)).toEqual(['set-text']);

    const back = commitElementProps(set.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { fontFamily: null },
    });
    expect(back.slides).toEqual(slides);
    // A blank name is no face either.
    const blank = commitElementProps(set.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { fontFamily: '   ' },
    });
    expect(blank.slides).toEqual(slides);
  });

  it('tracks every run within bounds and takes it back with null', () => {
    const slides = deck();
    const runsOf = (next: readonly SlideIr[]) => {
      const title = elementOf(next, 'opening', 'title');
      if (title?.kind !== 'text') throw new Error('not text');
      return title.paragraphs.flatMap((paragraph) => paragraph.runs);
    };
    const set = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { letterSpacingPt: 1.234 },
    });
    expectReversible(slides, set);
    expect(runsOf(set.slides).map((run) => run.letterSpacingPt)).toEqual([1.23, 1.23]);

    for (const [asked, kept] of [
      [-500, LETTER_SPACING_PT.min],
      [10_000, LETTER_SPACING_PT.max],
    ] as const) {
      const clamped = commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['title'],
        props: { letterSpacingPt: asked },
      });
      expect(runsOf(clamped.slides).every((run) => run.letterSpacingPt === kept)).toBe(true);
    }

    const back = commitElementProps(set.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { letterSpacingPt: null },
    });
    expect(runsOf(back.slides).some((run) => 'letterSpacingPt' in run)).toBe(false);
    expect(back.slides).toEqual(slides);
    expect(
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['title'],
        props: { letterSpacingPt: Number.NaN },
      }).change,
    ).toBeNull();
  });

  it('spaces the lines of every paragraph within bounds and takes it back with null', () => {
    const slides = deck();
    const spacingOf = (next: readonly SlideIr[]) => {
      const title = elementOf(next, 'opening', 'title');
      if (title?.kind !== 'text') throw new Error('not text');
      return title.paragraphs.map((paragraph) => paragraph.lineSpacing);
    };
    const set = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { lineSpacing: 1.5 },
    });
    expectReversible(slides, set);
    expect(spacingOf(set.slides)).toEqual([1.5]);
    expect(set.change?.ops.map((op) => op.op)).toEqual(['set-text']);

    for (const [asked, kept] of [
      [0.1, LINE_SPACING.min],
      [-2, LINE_SPACING.min],
      [40, LINE_SPACING.max],
    ] as const) {
      const clamped = commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['title'],
        props: { lineSpacing: asked },
      });
      expect(spacingOf(clamped.slides)).toEqual([kept]);
    }

    const back = commitElementProps(set.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      props: { lineSpacing: null },
    });
    // The contract keeps the key: null is how a paragraph inherits its spacing.
    expect(spacingOf(back.slides)).toEqual([null]);
    expect(back.slides).toEqual(slides);
    expect(
      commitElementProps(slides, {
        slideId: 'opening',
        elementIds: ['title'],
        props: { lineSpacing: Number.POSITIVE_INFINITY },
      }).change,
    ).toBeNull();
  });

  it('keeps text properties off every other kind', () => {
    const slides = deck();
    const commit = commitElementProps(slides, {
      slideId: 'opening',
      elementIds: ['panel', 'photo'],
      props: { fontFamily: 'Inter', letterSpacingPt: 2, lineSpacing: 2 },
    });
    expect(commit.change).toBeNull();
    expect(commit.slides).toBe(slides);
  });

  it('says which properties each kind takes, for a panel to read', () => {
    expect(ELEMENT_PROPS.text).toEqual(
      expect.arrayContaining(['fontFamily', 'letterSpacingPt', 'lineSpacing']),
    );
    expect(ELEMENT_PROPS.decor).toContain('stroke');
    expect(ELEMENT_PROPS.text).toContain('verticalAlign');
    expect(ELEMENT_PROPS.image).toContain('fit');
    expect(ELEMENT_PROPS.chart).toContain('chartType');
    for (const props of Object.values(ELEMENT_PROPS)) {
      expect(props).toContain('rotation');
      expect(props).toContain('locked');
    }
    expect(ELEMENT_PROPS.table).not.toContain('fill');
  });
});

describe('duplicate and paste', () => {
  it('copies elements above the topmost original with new ids and an offset', () => {
    const slides = deck();
    let seq = 0;
    const commit = commitDuplicate(slides, {
      slideId: 'opening',
      elementIds: ['title', 'panel'],
      nextId: () => `copy-${(seq += 1)}`,
    });
    expectReversible(slides, commit);
    expect(commit.slides[0]?.elements.map((element) => element.elementId)).toEqual([
      'title',
      'panel',
      'copy-1',
      'copy-2',
      'photo',
    ]);
    const copy = elementOf(commit.slides, 'opening', 'copy-1');
    expect(copy?.box).toEqual({
      ...ORIGIN,
      x: ORIGIN.x + Math.round(12_192_000 / 96),
      y: ORIGIN.y + Math.round(12_192_000 / 96),
    });
    expect(commit.change?.kind).toBe('duplicate');
    expect(commit.change?.before?.elementIds).toEqual(['title', 'panel']);
    expect(commit.change?.after?.elementIds).toEqual(['copy-1', 'copy-2']);
  });

  it('never reuses an id a slide already has', () => {
    const slides = deck();
    const ids = ['title', 'panel', 'fresh'];
    let seq = 0;
    const commit = commitDuplicate(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      offset: { x: 0, y: 0 },
      nextId: () => ids[seq++] ?? 'last',
    });
    expect(commit.change?.after?.elementIds).toEqual(['fresh']);
    expect(commit.slides[0]?.elements).toHaveLength(4);
  });

  it('pastes a set of elements on top with new ids', () => {
    const slides = deck();
    let seq = 0;
    const commit = commitPaste(slides, {
      slideId: 'middle',
      elements: [decor('panel'), text('title')],
      offset: { x: 10_000, y: 0 },
      nextId: () => `pasted-${(seq += 1)}`,
    });
    expectReversible(slides, commit);
    expect(commit.slides[1]?.elements.map((element) => element.elementId)).toEqual([
      'grid',
      'plot',
      'note',
      'pasted-1',
      'pasted-2',
    ]);
    expect(elementOf(commit.slides, 'middle', 'pasted-1')?.box.x).toBe(ORIGIN.x + 10_000);
    expect(commit.change?.kind).toBe('paste');
  });

  it('leaves the deck alone for an unknown slide, an empty set or an element that is not one', () => {
    const slides = deck();
    for (const commit of [
      commitDuplicate(slides, { slideId: 'opening', elementIds: ['note'] }),
      commitDuplicate(slides, { slideId: 'nowhere', elementIds: ['title'] }),
      commitPaste(slides, { slideId: 'opening', elements: [] }),
      commitPaste(slides, { slideId: 'nowhere', elements: [decor('panel')] }),
      commitPaste(slides, {
        slideId: 'opening',
        elements: [{ kind: 'text', elementId: 'broken' } as SlideElement],
      }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });
});

describe('paint order', () => {
  it('steps an element forward and back past its neighbour', () => {
    const slides = deck();
    const forward = commitArrange(slides, {
      slideId: 'opening',
      elementIds: ['title'],
      to: 'forward',
    });
    expectReversible(slides, forward);
    expect(forward.slides[0]?.elements.map((element) => element.elementId)).toEqual([
      'panel',
      'title',
      'photo',
    ]);
    const backward = commitArrange(forward.slides, {
      slideId: 'opening',
      elementIds: ['title'],
      to: 'backward',
    });
    expect(backward.slides[0]?.elements.map((element) => element.elementId)).toEqual([
      'title',
      'panel',
      'photo',
    ]);
    expect(backward.slides[0]).toEqual(slides[0]);
  });

  it('brings a selection to the front and to the back, keeping its own order', () => {
    const slides = deck();
    const front = commitArrange(slides, {
      slideId: 'opening',
      elementIds: ['title', 'panel'],
      to: 'front',
    });
    expectReversible(slides, front);
    expect(front.slides[0]?.elements.map((element) => element.elementId)).toEqual([
      'photo',
      'title',
      'panel',
    ]);
    const back = commitArrange(slides, {
      slideId: 'opening',
      elementIds: ['photo'],
      to: 'back',
    });
    expect(back.slides[0]?.elements.map((element) => element.elementId)).toEqual([
      'photo',
      'title',
      'panel',
    ]);
    expect(back.change?.kind).toBe('arrange');
  });

  it('leaves the deck alone when the element is already there or belongs elsewhere', () => {
    const slides = deck();
    for (const commit of [
      commitArrange(slides, { slideId: 'opening', elementIds: ['photo'], to: 'front' }),
      commitArrange(slides, { slideId: 'opening', elementIds: ['title'], to: 'back' }),
      commitArrange(slides, { slideId: 'opening', elementIds: ['note'], to: 'forward' }),
      commitArrange(slides, { slideId: 'nowhere', elementIds: ['title'], to: 'forward' }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });
});

describe('picture, table and chart', () => {
  it('points a picture at other media', () => {
    const slides = deck();
    const commit = commitReplaceImage(slides, {
      slideId: 'opening',
      elementId: 'photo',
      mediaPart: 'upload/a1.png',
    });
    expectReversible(slides, commit);
    expect(elementOf(commit.slides, 'opening', 'photo')).toMatchObject({
      mediaPart: 'upload/a1.png',
    });
    expect(commit.change?.kind).toBe('image');
    for (const commit of [
      commitReplaceImage(slides, {
        slideId: 'opening',
        elementId: 'panel',
        mediaPart: 'upload/a.png',
      }),
      commitReplaceImage(slides, { slideId: 'opening', elementId: 'photo', mediaPart: '  ' }),
      commitReplaceImage(slides, {
        slideId: 'middle',
        elementId: 'photo',
        mediaPart: 'upload/a.png',
      }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });

  it('writes a cell, the header included', () => {
    const slides = deck();
    const body = commitTableCell(slides, {
      slideId: 'middle',
      elementId: 'grid',
      cell: { row: 1, column: 0 },
      text: 'Вёрстка',
    });
    expectReversible(slides, body);
    const header = commitTableCell(body.slides, {
      slideId: 'middle',
      elementId: 'grid',
      cell: { row: 'header', column: 1 },
      text: 'Слой',
    });
    const grid = elementOf(header.slides, 'middle', 'grid');
    if (grid?.kind !== 'table') throw new Error('not a table');
    expect(grid.headers).toEqual(['Этап', 'Слой']);
    expect(grid.rows).toEqual([
      ['Разбор', 'Python'],
      ['Вёрстка', 'TypeScript'],
    ]);
    expect(header.change?.kind).toBe('table');
  });

  it('adds and removes rows and columns, and keeps the last of each', () => {
    const slides = deck();
    const row = commitInsertTableRow(slides, { slideId: 'middle', elementId: 'grid', index: 1 });
    expectReversible(slides, row);
    const column = commitInsertTableColumn(row.slides, {
      slideId: 'middle',
      elementId: 'grid',
      index: 2,
    });
    const grown = elementOf(column.slides, 'middle', 'grid');
    if (grown?.kind !== 'table') throw new Error('not a table');
    expect(grown.headers).toEqual(['Этап', 'Где', '']);
    expect(grown.rows).toEqual([
      ['Разбор', 'Python', ''],
      ['', '', ''],
      ['План', 'TypeScript', ''],
    ]);

    const smaller = commitRemoveTableColumn(column.slides, {
      slideId: 'middle',
      elementId: 'grid',
      index: 2,
    });
    const shorter = commitRemoveTableRow(smaller.slides, {
      slideId: 'middle',
      elementId: 'grid',
      index: 1,
    });
    expect(shorter.slides[1]).toEqual(slides[1]);

    const single = [
      slide('only', 0, [
        { ...table('grid'), headers: ['Одна'], rows: [['Строка']] } as SlideElement,
      ]),
    ];
    for (const commit of [
      commitRemoveTableRow(single, { slideId: 'only', elementId: 'grid', index: 0 }),
      commitRemoveTableColumn(single, { slideId: 'only', elementId: 'grid', index: 0 }),
      commitInsertTableRow(single, { slideId: 'only', elementId: 'grid', index: 9 }),
      commitTableCell(single, {
        slideId: 'only',
        elementId: 'grid',
        cell: { row: 9, column: 0 },
        text: 'мимо',
      }),
      commitTableCell(single, {
        slideId: 'only',
        elementId: 'nobody',
        cell: { row: 0, column: 0 },
        text: 'мимо',
      }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(single);
    }
  });

  it('replaces chart data and axis titles, and refuses data that does not line up', () => {
    const slides = deck();
    const data = commitChartData(slides, {
      slideId: 'middle',
      elementId: 'plot',
      categories: ['I', 'II', 'III'],
      series: [
        { name: 'План', values: [1, 2, 3] },
        { name: 'Факт', values: [3, 2, 1] },
      ],
    });
    expectReversible(slides, data);
    const plot = elementOf(data.slides, 'middle', 'plot');
    if (plot?.kind !== 'chart') throw new Error('not a chart');
    expect(plot.categories).toEqual(['I', 'II', 'III']);
    expect(plot.series[1]).toEqual({ name: 'Факт', values: [3, 2, 1] });

    const hole = commitChartData(slides, {
      slideId: 'middle',
      elementId: 'plot',
      categories: ['I', 'II'],
      series: [{ name: 'План', unit: 'шт', values: [0, null] }],
    });
    const holed = elementOf(hole.slides, 'middle', 'plot');
    if (holed?.kind !== 'chart') throw new Error('not a chart');
    expect(holed.series[0]).toEqual({ name: 'План', unit: 'шт', values: [0, null] });
    expect(data.change?.kind).toBe('chart');

    const axes = commitChartAxes(data.slides, {
      slideId: 'middle',
      elementId: 'plot',
      yTitle: 'Дни',
    });
    expect(elementOf(axes.slides, 'middle', 'plot')).toMatchObject({ yTitle: 'Дни', xTitle: '' });

    for (const commit of [
      commitChartData(slides, {
        slideId: 'middle',
        elementId: 'plot',
        categories: ['I', 'II'],
        series: [{ name: 'План', values: [1] }],
      }),
      commitChartData(slides, {
        slideId: 'middle',
        elementId: 'plot',
        categories: [],
        series: [{ name: 'План', values: [] }],
      }),
      commitChartData(slides, {
        slideId: 'middle',
        elementId: 'plot',
        categories: ['I'],
        series: [{ name: '', values: [1] }],
      }),
      commitChartData(slides, {
        slideId: 'middle',
        elementId: 'plot',
        categories: ['I'],
        series: [{ name: 'План', values: [Number.NaN] }],
      }),
      commitChartAxes(slides, { slideId: 'middle', elementId: 'grid', xTitle: 'нет' }),
      commitChartData(slides, {
        slideId: 'opening',
        elementId: 'plot',
        categories: ['I'],
        series: [{ name: 'План', values: [1] }],
      }),
    ]) {
      expect(commit.change).toBeNull();
      expect(commit.slides).toBe(slides);
    }
  });
});
