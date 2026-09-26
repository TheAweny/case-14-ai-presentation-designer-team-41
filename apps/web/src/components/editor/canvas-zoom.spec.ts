import { describe, expect, it } from 'vitest';
import { wheelActivatesZoom, zoomPercent, zoomScaleFor } from './zoom-input';

/** Слайд 13,33 × 7,5 дюйма: 1280 CSS-пикселей при 96 dpi. */
const SLIDE_CX = 12192000;
/** Лист, вписанный в область: вдвое меньше своего размера в шаблоне. */
const FITTED = 640;

describe('wheelActivatesZoom', () => {
  it('принимает Ctrl и Cmd по отдельности и молчит без них', () => {
    expect(wheelActivatesZoom(['Control'])).toBe(true);
    expect(wheelActivatesZoom(['Meta'])).toBe(true);
    expect(wheelActivatesZoom(['Shift'])).toBe(false);
    expect(wheelActivatesZoom([])).toBe(false);
  });
});

describe('zoomPercent', () => {
  it('считает процент от размера слайда в шаблоне, а не от вписанного листа', () => {
    expect(zoomPercent(1, FITTED, SLIDE_CX)).toBe(50);
    expect(zoomPercent(2, FITTED, SLIDE_CX)).toBe(100);
    expect(zoomPercent(4, FITTED, SLIDE_CX)).toBe(200);
  });

  it('без известного размера слайда показывает долю вписанного листа', () => {
    expect(zoomPercent(1, 0, SLIDE_CX)).toBe(100);
    expect(zoomPercent(2.5, FITTED, 0)).toBe(250);
  });
});

describe('zoomScaleFor', () => {
  it('обратен проценту', () => {
    expect(zoomScaleFor(1, FITTED, SLIDE_CX)).toBe(2);
    expect(zoomPercent(zoomScaleFor(0.5, FITTED, SLIDE_CX), FITTED, SLIDE_CX)).toBe(50);
  });

  it('без известного размера слайда доля и есть масштаб', () => {
    expect(zoomScaleFor(2, FITTED, 0)).toBe(2);
  });
});
