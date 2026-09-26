import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { boxStyle, boxToRect, emuToCqw, ptToCqw } from './geometry.js';
import { SlideFrame } from './slide-frame.js';

// Three proportions a template can have: nothing below may assume 16:9.
const WIDE = { cx: 12_192_000, cy: 6_858_000 };
const STANDARD = { cx: 9_144_000, cy: 6_858_000 };
const PORTRAIT = { cx: 6_858_000, cy: 9_144_000 };

describe('boxToRect', () => {
  it('turns EMU into shares of a 16:9 slide', () => {
    expect(boxToRect({ x: 609_600, y: 342_900, cx: 6_096_000, cy: 3_429_000 }, WIDE)).toEqual({
      left: 5,
      top: 5,
      width: 50,
      height: 50,
    });
  });

  it('turns EMU into shares of a 4:3 slide', () => {
    expect(boxToRect({ x: 914_400, y: 685_800, cx: 4_572_000, cy: 3_429_000 }, STANDARD)).toEqual({
      left: 10,
      top: 10,
      width: 50,
      height: 50,
    });
  });

  it('measures width against width and height against height on a portrait slide', () => {
    const rect = boxToRect({ x: 914_400, y: 685_800, cx: 4_572_000, cy: 3_429_000 }, PORTRAIT);
    expect(rect.left).toBeCloseTo(13.3333, 4);
    expect(rect.top).toBeCloseTo(7.5, 10);
    expect(rect.width).toBeCloseTo(66.6667, 4);
    expect(rect.height).toBeCloseTo(37.5, 10);
  });

  it('keeps boxes past the slide edge as they are', () => {
    expect(boxToRect({ x: -609_600, y: 0, cx: 12_801_600, cy: 6_858_000 }, WIDE)).toEqual({
      left: -5,
      top: 0,
      width: 105,
      height: 100,
    });
  });
});

describe('type size and lengths in cqw', () => {
  it('converts points through EMU against the slide width', () => {
    expect(ptToCqw(16, WIDE)).toBeCloseTo((16 * 12_700 * 100) / 12_192_000, 10);
    expect(ptToCqw(16, WIDE)).toBeCloseTo(1.6667, 4);
    expect(ptToCqw(18, STANDARD)).toBeCloseTo(2.5, 10);
    expect(ptToCqw(27, PORTRAIT)).toBeCloseTo(5, 10);
  });

  it('gives the same type a larger share of a narrower slide', () => {
    expect(ptToCqw(20, PORTRAIT)).toBeGreaterThan(ptToCqw(20, STANDARD));
    expect(ptToCqw(20, STANDARD)).toBeGreaterThan(ptToCqw(20, WIDE));
  });

  it('converts EMU lengths', () => {
    expect(emuToCqw(914_400, STANDARD)).toBeCloseTo(10, 10);
    expect(emuToCqw(12_192_000, WIDE)).toBe(100);
  });
});

describe('boxStyle', () => {
  it('places a box absolutely in rounded percentages', () => {
    expect(boxStyle({ x: 914_400, y: 685_800, cx: 4_572_000, cy: 3_429_000 }, PORTRAIT)).toEqual({
      position: 'absolute',
      left: '13.3333%',
      top: '7.5%',
      width: '66.6667%',
      height: '37.5%',
    });
  });
});

describe('SlideFrame', () => {
  it('takes its proportions from the slide and becomes the query container', () => {
    const html = renderToStaticMarkup(createElement(SlideFrame, { size: STANDARD }));
    expect(html).toContain('aspect-ratio:9144000 / 6858000');
    expect(html).toContain('container-type:inline-size');
    expect(html).toContain('position:relative');
  });

  it('passes host attributes through and paints nothing of its own', () => {
    const html = renderToStaticMarkup(
      createElement(
        SlideFrame,
        { size: WIDE, className: 'host', 'aria-label': 'Slide', style: { width: '10rem' } },
        'content',
      ),
    );
    expect(html).toContain('class="host"');
    expect(html).toContain('aria-label="Slide"');
    expect(html).toContain('width:10rem');
    expect(html).toContain('content');
    expect(html).not.toMatch(/background|color:/);
  });
});
