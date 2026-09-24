import { applyPatches, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { slideIrSchema, type Paragraph, type SlideElement, type SlideIr } from '@lct/contracts';
import type { DeckCommit } from './core.js';
import {
  commitSetColor,
  commitSetFontSize,
  createDeckHistory,
  recordChange,
  redoDeck,
  undoDeck,
} from './journal.js';
import { commitImageCrop, commitShapeText, commitSlideNotes, normalCrop } from './content-ops.js';
import { commitElementProps } from './element-ops.js';

function words(text: string): Paragraph[] {
  return [
    {
      level: 0,
      lineSpacing: null,
      runs: [{ text, font: '', sizePt: null, bold: null, italic: null, color: '' }],
    },
  ];
}

const card: SlideElement = {
  kind: 'decor',
  elementId: 'card',
  role: 'decoration',
  box: { x: 100, y: 100, cx: 4000, cy: 2000 },
  sourceShapeId: null,
  shape: 'rect',
  fill: 'accent',
  stroke: null,
};

const rule: SlideElement = { ...card, elementId: 'rule', shape: 'line' };

const photo: SlideElement = {
  kind: 'image',
  elementId: 'photo',
  role: 'image',
  box: { x: 1000, y: 1000, cx: 4000, cy: 3000 },
  sourceShapeId: null,
  mediaPart: 'upload/photo.png',
  fit: 'cover',
};

function deck(): SlideIr[] {
  return [
    {
      schemaVersion: 1,
      slideId: 'one',
      variant: 'balanced',
      index: 0,
      patternId: 'pattern',
      slideCx: 12_192_000,
      slideCy: 6_858_000,
      elements: [card, rule, photo],
    },
  ];
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
  expect(redoDeck(undoDeck(history)).slides).toEqual(commit.slides);
}

function element(slides: readonly SlideIr[], elementId: string): SlideElement | undefined {
  return slides[0]?.elements.find((item) => item.elementId === elementId);
}

describe('commitShapeText', () => {
  it('puts words into a shape as one step, and takes them away when they are blank', () => {
    const before = deck();
    const typed = commitShapeText(before, {
      slideId: 'one',
      elementId: 'card',
      paragraphs: words('Шаг 1'),
    });
    expectReversible(before, typed);
    expect(typed.change?.kind).toBe('text');
    expect(typed.change?.ops).toEqual([]);
    const shaped = element(typed.slides, 'card');
    expect(shaped?.kind === 'decor' && shaped.paragraphs).toEqual(words('Шаг 1'));

    const cleared = commitShapeText(typed.slides, {
      slideId: 'one',
      elementId: 'card',
      paragraphs: words('   '),
    });
    expectReversible(typed.slides, cleared);
    expect(element(cleared.slides, 'card')).toEqual(card);
  });

  it('changes nothing for the same words, blank words on an empty shape, a line or a picture', () => {
    const before = deck();
    const typed = commitShapeText(before, {
      slideId: 'one',
      elementId: 'card',
      paragraphs: words('Шаг 1'),
    }).slides;
    const same = { slideId: 'one', elementId: 'card', paragraphs: words('Шаг 1') };
    expect(commitShapeText(typed, same).change).toBeNull();
    expect(
      commitShapeText(before, { slideId: 'one', elementId: 'card', paragraphs: words('') }).change,
    ).toBeNull();
    for (const elementId of ['rule', 'photo', 'missing']) {
      expect(
        commitShapeText(before, { slideId: 'one', elementId, paragraphs: words('Нет') }).change,
      ).toBeNull();
    }
  });

  it('gives the words in a shape the look of text: runs, paragraphs and the anchor', () => {
    const typed = commitShapeText(deck(), {
      slideId: 'one',
      elementId: 'card',
      paragraphs: words('Шаг 1'),
    }).slides;
    const styled = commitElementProps(typed, {
      slideId: 'one',
      elementIds: ['card'],
      props: { bold: true, fontFamily: 'Deck Face', align: 'left', verticalAlign: 'top' },
    });
    expectReversible(typed, styled);
    const shape = element(styled.slides, 'card');
    if (shape?.kind !== 'decor') throw new Error('card is not a shape');
    expect(shape.verticalAlign).toBe('top');
    expect(shape.fill).toBe('accent');
    expect(shape.paragraphs?.[0]?.align).toBe('left');
    expect(shape.paragraphs?.[0]?.runs[0]).toMatchObject({ bold: true, font: 'Deck Face' });

    const sized = commitSetFontSize(styled.slides, {
      slideId: 'one',
      elementId: 'card',
      sizePt: 28,
    });
    expectReversible(styled.slides, sized);
    // `set-font-size` and `set-color` of the engine mean a text element; on a shape the colour
    // op would repaint its fill. The words travel with the slide instead.
    expect(sized.change?.ops).toEqual([]);
    const colored = commitSetColor(sized.slides, {
      slideId: 'one',
      elementId: 'card',
      color: 'surface',
      hex: 'FFFFFF',
    });
    expectReversible(sized.slides, colored);
    expect(colored.change?.ops).toEqual([]);
    const done = element(colored.slides, 'card');
    expect(done?.kind === 'decor' && done.paragraphs?.[0]?.runs[0]).toMatchObject({
      sizePt: 28,
      color: 'FFFFFF',
    });
    expect(done?.kind === 'decor' && done.fill).toBe('accent');
  });

  it('leaves a shape without words as it is', () => {
    const before = deck();
    expect(
      commitElementProps(before, {
        slideId: 'one',
        elementIds: ['card'],
        props: { bold: true, verticalAlign: 'top' },
      }).change,
    ).toBeNull();
    expect(
      commitSetFontSize(before, { slideId: 'one', elementId: 'card', sizePt: 20 }).change,
    ).toBeNull();
  });
});

describe('commitImageCrop', () => {
  it('crops a picture and gives it the frame of the crop, as one step', () => {
    const before = deck();
    const box = { x: 1500, y: 1000, cx: 2000.4, cy: 3000 };
    const cropped = commitImageCrop(before, {
      slideId: 'one',
      elementId: 'photo',
      crop: { l: 0.125, t: 0, r: 0.375, b: 0 },
      box,
    });
    expectReversible(before, cropped);
    expect(cropped.change?.kind).toBe('crop');
    expect(element(cropped.slides, 'photo')).toMatchObject({
      crop: { l: 0.125, t: 0, r: 0.375, b: 0 },
      box: { x: 1500, y: 1000, cx: 2000, cy: 3000 },
    });
  });

  it('takes the crop away on null or on a crop that cuts nothing', () => {
    const cropped = commitImageCrop(deck(), {
      slideId: 'one',
      elementId: 'photo',
      crop: { l: 0.1, t: 0.1, r: 0.1, b: 0.1 },
    }).slides;
    const reset = commitImageCrop(cropped, { slideId: 'one', elementId: 'photo', crop: null });
    expectReversible(cropped, reset);
    expect(element(reset.slides, 'photo')).toEqual(photo);
    const zero = commitImageCrop(cropped, {
      slideId: 'one',
      elementId: 'photo',
      crop: { l: 0, t: 0, r: 0, b: 1e-9 },
    });
    expect(element(zero.slides, 'photo')).toEqual(photo);
  });

  it('refuses a crop that leaves nothing, and anything but a picture', () => {
    const before = deck();
    const gone = { l: 0.5, t: 0, r: 0.5, b: 0 };
    expect(
      commitImageCrop(before, { slideId: 'one', elementId: 'photo', crop: gone }).change,
    ).toBeNull();
    expect(
      commitImageCrop(before, {
        slideId: 'one',
        elementId: 'card',
        crop: { l: 0.1, t: 0, r: 0, b: 0 },
      }).change,
    ).toBeNull();
    expect(
      commitImageCrop(before, {
        slideId: 'one',
        elementId: 'photo',
        crop: { l: 0.1, t: 0, r: 0, b: 0 },
        box: { x: 0, y: 0, cx: 0, cy: 100 },
      }).change,
    ).toBeNull();
    expect(commitImageCrop(before, { slideId: 'one', elementId: 'photo', crop: null }).change).toBe(
      null,
    );
  });

  it('drops the crop when a fit is chosen, even the fit the picture already has', () => {
    const cropped = commitImageCrop(deck(), {
      slideId: 'one',
      elementId: 'photo',
      crop: { l: 0.1, t: 0, r: 0, b: 0 },
    }).slides;
    const refit = commitElementProps(cropped, {
      slideId: 'one',
      elementIds: ['photo'],
      props: { fit: 'cover' },
    });
    expectReversible(cropped, refit);
    expect(element(refit.slides, 'photo')).toEqual(photo);
  });

  it('rounds a crop to what srcRect says and clamps a negative side', () => {
    expect(normalCrop({ l: 0.123_456_7, t: -0.2, r: 0, b: 0.5 })).toEqual({
      l: 0.12346,
      t: 0,
      r: 0,
      b: 0.5,
    });
    expect(normalCrop({ l: Number.NaN, t: 0, r: 0, b: 0 })).toBeNull();
    expect(normalCrop({ l: 0, t: 0.6, r: 0, b: 0.4 })).toBeNull();
  });
});

describe('commitSlideNotes', () => {
  it('writes notes as one step and keeps their lines', () => {
    const before = deck();
    const noted = commitSlideNotes(before, {
      slideId: 'one',
      notes: 'Начать с выручки.\r\nПотом сроки.',
    });
    expectReversible(before, noted);
    expect(noted.change?.kind).toBe('notes');
    expect(noted.slides[0]?.notes).toBe('Начать с выручки.\nПотом сроки.');
  });

  it('takes blank notes away and leaves the same notes alone', () => {
    const noted = commitSlideNotes(deck(), { slideId: 'one', notes: 'Коротко' }).slides;
    expect(commitSlideNotes(noted, { slideId: 'one', notes: 'Коротко' }).change).toBeNull();
    const cleared = commitSlideNotes(noted, { slideId: 'one', notes: '  \n ' });
    expectReversible(noted, cleared);
    expect(cleared.slides[0]).not.toHaveProperty('notes');
    expect(commitSlideNotes(deck(), { slideId: 'one', notes: '' }).change).toBeNull();
    expect(commitSlideNotes(deck(), { slideId: 'missing', notes: 'Нет' }).change).toBeNull();
  });
});
