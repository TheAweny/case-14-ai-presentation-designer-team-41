import type { CSSProperties } from 'react';
import type { Box, SlideIr } from '@lct/contracts';

/**
 * Slide geometry for anything drawn inside a `SlideFrame`.
 *
 * The IR stores geometry in EMU, as OOXML does, and the size of the slide comes from the template,
 * so nothing here assumes an aspect ratio. Positions become percentages of the slide, lengths
 * become `cqw` — hundredths of the slide width, because the frame is the query container — and a
 * slide therefore looks the same at thumbnail size and on the canvas.
 */

export const EMU_PER_PT = 12_700;

/** Slide size in EMU, as the template states it. */
export interface SlideSize {
  readonly cx: number;
  readonly cy: number;
}

/** A box as percentages of the slide: left and width of its width, top and height of its height. */
export interface SlideRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function slideSizeOf(slide: Pick<SlideIr, 'slideCx' | 'slideCy'>): SlideSize {
  return { cx: slide.slideCx, cy: slide.slideCy };
}

export function boxToRect(box: Box, size: SlideSize): SlideRect {
  return {
    left: (box.x / size.cx) * 100,
    top: (box.y / size.cy) * 100,
    width: (box.cx / size.cx) * 100,
    height: (box.cy / size.cy) * 100,
  };
}

/** A length in EMU as `cqw` of a frame showing a slide of this size. */
export function emuToCqw(emu: number, size: SlideSize): number {
  return (emu / size.cx) * 100;
}

/** A type size in points as `cqw`: the same share of the slide width at any rendered size. */
export function ptToCqw(pt: number, size: SlideSize): number {
  return emuToCqw(pt * EMU_PER_PT, size);
}

/**
 * Four decimals: a ten-thousandth of a percent is a tenth of a pixel on a 1000-pixel slide, and
 * shorter numbers keep the markup of a thumbnail strip small.
 */
export function round(value: number): number {
  const rounded = Math.round(value * 10_000) / 10_000;
  return rounded === 0 ? 0 : rounded;
}

export function percent(value: number): string {
  return `${round(value)}%`;
}

export function cqw(value: number): string {
  return `${round(value)}cqw`;
}

/** Absolute placement of a box inside a `SlideFrame`. */
export function boxStyle(box: Box, size: SlideSize): CSSProperties {
  const rect = boxToRect(box, size);
  return {
    position: 'absolute',
    left: percent(rect.left),
    top: percent(rect.top),
    width: percent(rect.width),
    height: percent(rect.height),
  };
}
