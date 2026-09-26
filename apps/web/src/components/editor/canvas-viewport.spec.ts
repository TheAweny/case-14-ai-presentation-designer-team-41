import { describe, expect, it } from 'vitest';
import {
  clampCanvasScale,
  clampToRegion,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  pasteboardRegion,
  transformToFit,
  wheelIntent,
  wheelZoomFactor,
  zoomAtPoint,
} from './canvas-viewport';
import { zoomPercent, zoomScaleFor } from './zoom-input';

describe('canvas zoom', () => {
  it('keeps the scale between a quarter of the fit and the ceiling', () => {
    expect(clampCanvasScale(0.01)).toBe(MIN_CANVAS_SCALE);
    expect(clampCanvasScale(40)).toBe(MAX_CANVAS_SCALE);
    expect(clampCanvasScale(1.5)).toBe(1.5);
    expect(clampCanvasScale(Number.NaN)).toBe(1);
  });

  it('turns one wheel notch into a moderate step and a pinch into a smooth one', () => {
    const notch = wheelZoomFactor(-100);
    expect(notch).toBeGreaterThan(1.15);
    expect(notch).toBeLessThan(1.3);
    // Обратный щелчок возвращает туда же, откуда пришли.
    expect(notch * wheelZoomFactor(100)).toBeCloseTo(1, 6);
    const pinch = wheelZoomFactor(-4);
    expect(pinch).toBeGreaterThan(1);
    expect(pinch).toBeLessThan(1.02);
  });

  it('never lets one wheel event jump the whole range', () => {
    expect(wheelZoomFactor(-4000)).toBeLessThan(1.3);
    expect(wheelZoomFactor(-3, 1)).toBeLessThan(1.3);
  });

  it('keeps 100 % of the template size inside the range the canvas allows', () => {
    // Лист 16:9 шириной 12 192 000 EMU — это 1280 px; вписан он в 640 px.
    const actual = zoomScaleFor(1, 640, 12192000);
    expect(actual).toBeCloseTo(2, 6);
    expect(clampCanvasScale(actual)).toBe(actual);
    expect(zoomPercent(clampCanvasScale(actual), 640, 12192000)).toBe(100);
  });

  it('centres a selection in the visible area with room around it', () => {
    const next = transformToFit(
      { left: 100, top: 100, width: 100, height: 50 },
      { left: 0, top: 0, width: 800, height: 400 },
      { scale: 1, positionX: 0, positionY: 0 },
      0.1,
    );
    expect(next).not.toBeNull();
    expect(next?.scale).toBeCloseTo(6.4, 6);
    // Центр выделения (150, 125) встаёт в центр области (400, 200).
    expect((next?.positionX ?? 0) + 150 * 6.4).toBeCloseTo(400, 6);
    expect((next?.positionY ?? 0) + 125 * 6.4).toBeCloseTo(200, 6);
  });

  it('has nothing to fit when the selection has no size', () => {
    expect(
      transformToFit(
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 0, top: 0, width: 800, height: 400 },
        { scale: 1, positionX: 0, positionY: 0 },
      ),
    ).toBeNull();
  });

  it('keeps the point under the cursor in place while zooming', () => {
    const next = zoomAtPoint({ scale: 1, positionX: 10, positionY: 20 }, { x: 110, y: 70 }, 2);
    expect(next.scale).toBe(2);
    // Точка содержимого (100, 50) была под курсором и осталась там.
    expect(next.positionX + 100 * 2).toBeCloseTo(110, 6);
    expect(next.positionY + 50 * 2).toBeCloseTo(70, 6);
    expect(zoomAtPoint({ scale: 1, positionX: 0, positionY: 0 }, { x: 0, y: 0 }, 99).scale).toBe(
      MAX_CANVAS_SCALE,
    );
  });
});

describe('canvas wheel', () => {
  it('zooms with Ctrl or Cmd and with a trackpad pinch', () => {
    const zoom = wheelIntent({ deltaX: 0, deltaY: -100, ctrlKey: true });
    expect(zoom.kind).toBe('zoom');
    if (zoom.kind === 'zoom') expect(zoom.factor).toBeCloseTo(wheelZoomFactor(-100), 9);
    expect(wheelIntent({ deltaX: 0, deltaY: 4, metaKey: true }).kind).toBe('zoom');
  });

  it('pans vertically with a plain wheel: scrolling down lifts the sheet', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100 })).toEqual({ kind: 'pan', dx: 0, dy: -100 });
  });

  it('pans horizontally with Shift, whichever axis the browser reported', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100, shiftKey: true })).toEqual({
      kind: 'pan',
      dx: -100,
      dy: 0,
    });
    expect(wheelIntent({ deltaX: 100, deltaY: 0, shiftKey: true })).toEqual({
      kind: 'pan',
      dx: -100,
      dy: 0,
    });
  });

  it('follows two fingers on a trackpad on both axes', () => {
    expect(wheelIntent({ deltaX: -12, deltaY: 30 })).toEqual({ kind: 'pan', dx: 12, dy: -30 });
  });

  it('turns lines and pages into pixels', () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({
      kind: 'pan',
      dx: 0,
      dy: -48,
    });
    const page = wheelIntent({ deltaX: 0, deltaY: 1, deltaMode: 2 });
    expect(page.kind === 'pan' && page.dy < -100).toBe(true);
  });
});

describe('pasteboard', () => {
  const slide = { left: 100, top: 50, width: 400, height: 200 };
  const viewport = { width: 600, height: 300 };

  it('leaves half a slide of room on every side', () => {
    expect(pasteboardRegion(slide)).toEqual({ left: -100, top: -50, width: 800, height: 400 });
  });

  it('reaches objects put far past the slide edge', () => {
    const region = pasteboardRegion(slide, [{ left: 900, top: 60, width: 100, height: 40 }]);
    expect(region.left).toBe(-100);
    expect(region.left + region.width).toBe(1000);
    expect(region.height).toBe(400);
  });

  it('leaves half the screen of room when that is more than half a slide', () => {
    expect(pasteboardRegion(slide, [], { width: 300, height: 50 })).toEqual({
      left: -200,
      top: -50,
      width: 1000,
      height: 400,
    });
  });

  it('lets the view travel around the slide but not past the room', () => {
    const region = pasteboardRegion(slide);
    const start = { scale: 1, positionX: 0, positionY: 0 };
    // Поле 800 × 400 больше области 600 × 300: область не выходит за поле.
    const at = (positionX: number, positionY = 0) =>
      clampToRegion({ ...start, positionX, positionY }, start, viewport, region);
    expect(at(50).positionX).toBe(50);
    expect(at(500).positionX).toBe(100);
    expect(at(-900).positionX).toBe(-100);
    expect(at(0, -900).positionY).toBe(-50);
    expect(at(0, 900).positionY).toBe(50);
  });

  it('keeps a small zoomed-out field on screen', () => {
    const region = pasteboardRegion(slide);
    const start = { scale: 0.25, positionX: 200, positionY: 100 };
    // Поле при 0,25 — 200 × 100: целиком в области; у левого края сдвиг 25, у правого — 425.
    const at = (positionX: number) =>
      clampToRegion({ ...start, positionX }, start, viewport, region).positionX;
    expect(at(-500)).toBe(25);
    expect(at(900)).toBe(425);
  });

  it('never jerks a view that is already outside back in, but lets it come back', () => {
    const region = pasteboardRegion(slide);
    const outside = { scale: 1, positionX: 300, positionY: 0 };
    const at = (positionX: number) =>
      clampToRegion({ ...outside, positionX }, outside, viewport, region).positionX;
    expect(at(320)).toBe(300);
    expect(at(250)).toBe(250);
  });
});
