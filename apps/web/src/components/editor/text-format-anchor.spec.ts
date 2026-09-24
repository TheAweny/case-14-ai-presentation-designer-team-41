import { describe, expect, it } from 'vitest';
import { barBounds, formatBarAnchor } from './text-format-anchor';

describe('format bar bounds', () => {
  const AREA = { left: 240, top: 0, right: 1160, bottom: 900 };
  const RAIL = { left: 252, top: 220, right: 306, bottom: 680 };

  it('keeps the bar clear of the tool rail on its side', () => {
    expect(barBounds(AREA, { rect: RAIL, side: 'left' })).toEqual({ ...AREA, left: 306 });
    expect(barBounds(AREA, { rect: { ...RAIL, left: 1100, right: 1150 }, side: 'right' })).toEqual({
      ...AREA,
      right: 1100,
    });
    expect(barBounds(AREA, { rect: { ...RAIL, top: 10, bottom: 60 }, side: 'top' })).toEqual({
      ...AREA,
      top: 60,
    });
  });

  it('reads a DOMRect, whose sides live on the prototype', () => {
    class Rect {
      get left() {
        return AREA.left;
      }
      get top() {
        return AREA.top;
      }
      get right() {
        return AREA.right;
      }
      get bottom() {
        return AREA.bottom;
      }
    }
    expect(barBounds(new Rect(), { rect: RAIL, side: 'left' })).toEqual({ ...AREA, left: 306 });
  });

  it('is the whole canvas without a rail, or when the rail leaves no room', () => {
    expect(barBounds(AREA, null)).toBe(AREA);
    expect(barBounds(AREA, { rect: { ...RAIL, right: 1200 }, side: 'left' })).toBe(AREA);
  });
});

const FRAME = { left: 100, top: 300, right: 700, bottom: 500 };

function caret(left: number, top: number) {
  return { left, right: left, top, bottom: top + 20 };
}

describe('format bar anchor', () => {
  it('stands over the selected words, above the whole frame, so no line is covered', () => {
    const anchor = formatBarAnchor({
      frame: FRAME,
      from: caret(220, 340),
      to: caret(310, 341),
      empty: false,
      visibleTop: 0,
      room: 48,
    });
    expect(anchor).toEqual({ left: 220, right: 310, top: 300, bottom: 500 });
  });

  it('spans the frame width over several selected lines', () => {
    const anchor = formatBarAnchor({
      frame: FRAME,
      from: caret(400, 340),
      to: caret(150, 400),
      empty: false,
      visibleTop: 0,
      room: 48,
    });
    expect(anchor).toEqual(FRAME);
  });

  it('stays over the frame while typing, not jumping after the caret', () => {
    const anchor = formatBarAnchor({
      frame: FRAME,
      from: caret(400, 420),
      to: caret(400, 420),
      empty: true,
      visibleTop: 0,
      room: 48,
    });
    expect(anchor).toEqual(FRAME);
  });

  it('follows the edited lines when the frame top is out of view', () => {
    const caretLine = formatBarAnchor({
      frame: FRAME,
      from: caret(400, 420),
      to: caret(400, 420),
      empty: true,
      visibleTop: 280,
      room: 48,
    });
    expect(caretLine).toEqual({ left: 100, right: 700, top: 420, bottom: 440 });
    const selection = formatBarAnchor({
      frame: FRAME,
      from: caret(220, 440),
      to: caret(310, 440),
      empty: false,
      visibleTop: 280,
      room: 48,
    });
    expect(selection).toEqual({ left: 220, right: 310, top: 440, bottom: 460 });
  });
});
