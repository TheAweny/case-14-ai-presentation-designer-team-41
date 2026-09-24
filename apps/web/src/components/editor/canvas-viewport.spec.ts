import { describe, expect, it } from 'vitest';
import {
  clampCanvasScale,
  clampPosition,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  transformToFit,
  wheelZoomFactor,
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

  it('keeps the sheet against the edges when it is larger and centred when it is smaller', () => {
    expect(clampPosition(50, 800, 2)).toBe(0);
    expect(clampPosition(-2000, 800, 2)).toBe(-800);
    expect(clampPosition(-100, 800, 0.5)).toBe(200);
  });
});
