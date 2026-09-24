import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import { parseNumber, stepNumber } from './number-input';
import {
  alignToSlide,
  commonValue,
  cornerRadiusProps,
  cornerRadiusPt,
  emuToPt,
  maxCornerRadiusPt,
  ptToEmu,
  setBoxField,
  setBoxFieldEach,
  setBoxSizeLocked,
} from './selection-model';

const PT = 12_700;

function decor(elementId: string, box: SlideElement['box'], extra: object = {}): SlideElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box,
    sourceShapeId: null,
    shape: 'rect',
    fill: 'accent',
    stroke: null,
    ...extra,
  } as SlideElement;
}

describe('parseNumber', () => {
  it('reads a comma or a dot as the decimal mark', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber(' 12.5 ')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('1 024')).toBe(1024);
  });

  it('gives null for empty or malformed input', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('12px')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
  });
});

describe('stepNumber', () => {
  it('leaves no floating-point dust', () => {
    expect(stepNumber(0.1, 0.2)).toBe(0.3);
    expect(stepNumber(10, -0.5)).toBe(9.5);
  });
});

describe('commonValue', () => {
  it('is the shared value, or null when the selection differs', () => {
    const a = decor('a', { x: 0, y: 0, cx: 10, cy: 10 });
    const b = decor('b', { x: 0, y: 5, cx: 10, cy: 10 });
    expect(commonValue([a, b], (element) => element.box.x)).toBe(0);
    expect(commonValue([a, b], (element) => element.box.y)).toBeNull();
    expect(commonValue([], (element) => element.box.x)).toBeNull();
  });
});

describe('points', () => {
  it('round-trips through EMU', () => {
    expect(emuToPt(PT * 36)).toBe(36);
    expect(ptToEmu(36)).toBe(PT * 36);
  });
});

describe('setBoxField', () => {
  it('sets the field on every selected element and skips the ones already there', () => {
    const a = decor('a', { x: 0, y: 0, cx: PT, cy: PT });
    const b = decor('b', { x: PT * 10, y: 0, cx: PT, cy: PT });
    expect(setBoxField([a, b], 'x', 10)).toEqual([
      { elementId: 'a', box: { x: PT * 10, y: 0, cx: PT, cy: PT } },
    ]);
  });

  it('never makes a size smaller than a point', () => {
    const a = decor('a', { x: 0, y: 0, cx: PT * 5, cy: PT * 5 });
    expect(setBoxField([a], 'cx', 0)[0]?.box.cx).toBe(PT);
  });
});

describe('setBoxSizeLocked', () => {
  it('keeps the aspect ratio', () => {
    const a = decor('a', { x: 0, y: 0, cx: PT * 20, cy: PT * 10 });
    expect(setBoxSizeLocked([a], 'cx', 40)[0]?.box).toEqual({
      x: 0,
      y: 0,
      cx: PT * 40,
      cy: PT * 20,
    });
    expect(setBoxSizeLocked([a], 'cy', 5)[0]?.box).toEqual({ x: 0, y: 0, cx: PT * 10, cy: PT * 5 });
  });
});

describe('alignToSlide', () => {
  const slide = { slideCx: PT * 960, slideCy: PT * 540 };
  const a = decor('a', { x: PT * 10, y: PT * 20, cx: PT * 100, cy: PT * 40 });

  it('moves a single element to the slide edge or centre', () => {
    expect(alignToSlide([a], 'right', slide)[0]?.box.x).toBe(PT * 860);
    expect(alignToSlide([a], 'center', slide)[0]?.box.x).toBe(PT * 430);
    expect(alignToSlide([a], 'middle', slide)[0]?.box.y).toBe(PT * 250);
    expect(alignToSlide([a], 'bottom', slide)[0]?.box.y).toBe(PT * 500);
  });

  it('records nothing for an element already in place', () => {
    const placed = decor('p', { x: 0, y: 0, cx: PT, cy: PT });
    expect(alignToSlide([placed], 'left', slide)).toEqual([]);
  });
});

describe('setBoxFieldEach', () => {
  it('moves each object from its own value', () => {
    const a = decor('a', { x: PT * 10, y: 0, cx: PT, cy: PT });
    const b = decor('b', { x: PT * 25, y: 0, cx: PT, cy: PT });
    const moves = setBoxFieldEach([a, b], 'x', (old) => old + 10);
    expect(moves.map((move) => move.box.x)).toEqual([PT * 20, PT * 35]);
  });

  it('leaves out objects the edit does not change', () => {
    const a = decor('a', { x: PT * 10, y: 0, cx: PT, cy: PT });
    expect(setBoxFieldEach([a], 'x', (old) => old)).toEqual([]);
  });
});

type Decor = Extract<SlideElement, { kind: 'decor' }>;

describe('corner radius in points', () => {
  const box = { x: 0, y: 0, cx: PT * 200, cy: PT * 100 };

  it('reads a share of the shorter side as points, with the contract default', () => {
    expect(
      cornerRadiusPt(decor('a', box, { shape: 'round-rect', cornerRadius: 0.1 }) as Decor),
    ).toBeCloseTo(10);
    expect(cornerRadiusPt(decor('a', box, { shape: 'round-rect' }) as Decor)).toBeCloseTo(100 / 6);
    expect(cornerRadiusPt(decor('a', box, { shape: 'rect' }) as Decor)).toBe(0);
    expect(cornerRadiusPt(decor('a', box, { shape: 'ellipse' }) as Decor)).toBeNull();
    expect(maxCornerRadiusPt(decor('a', box) as Decor)).toBe(50);
  });

  it('turns points back into a share and rounds a rectangle only when asked', () => {
    const rect = decor('a', box, { shape: 'rect' }) as Decor;
    expect(cornerRadiusProps(rect, 12)).toEqual({ shape: 'round-rect', cornerRadius: 0.12 });
    expect(cornerRadiusProps(rect, 0)).toEqual({ shape: 'rect' });
    expect(cornerRadiusProps(rect, 500)).toEqual({ shape: 'round-rect', cornerRadius: 0.5 });
  });
});
