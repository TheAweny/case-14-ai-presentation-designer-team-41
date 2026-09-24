import { describe, expect, it } from 'vitest';
import { fitTextBox, pxToEmu, textFitOf } from './text-fit';

const BOX = { x: 100, y: 200, cx: 1_000, cy: 400 };

describe('text fit', () => {
  it('grows a box drawn in the editor, keeps a template box', () => {
    expect(textFitOf({ sourceShapeId: null })).toBe('grow');
    expect(textFitOf({ sourceShapeId: 7 })).toBe('fixed');
  });

  it('converts screen pixels to slide EMU whatever the zoom', () => {
    expect(pxToEmu(50, 500, 12_192_000)).toBe(1_219_200);
    expect(pxToEmu(100, 1_000, 12_192_000)).toBe(1_219_200);
    expect(pxToEmu(10, 0, 12_192_000)).toBe(0);
  });

  it('grows downwards to the text and keeps the top-left corner', () => {
    const fitted = fitTextBox(BOX, 612.4, 'grow');
    expect(fitted).toEqual({ box: { x: 100, y: 200, cx: 1_000, cy: 613 }, overflow: false });
  });

  it('never shrinks below the height the box started with', () => {
    expect(fitTextBox(BOX, 120, 'grow').box).toBe(BOX);
  });

  it('keeps a template box and reports the overflow instead', () => {
    expect(fitTextBox(BOX, 612, 'fixed')).toEqual({ box: BOX, overflow: true });
    expect(fitTextBox(BOX, 400, 'fixed')).toEqual({ box: BOX, overflow: false });
  });

  it('ignores sub-pixel overshoot within the tolerance', () => {
    expect(fitTextBox(BOX, 405, 'fixed', 10).overflow).toBe(false);
    expect(fitTextBox(BOX, 405, 'grow', 10).box).toBe(BOX);
    expect(fitTextBox(BOX, 411, 'fixed', 10).overflow).toBe(true);
  });
});
