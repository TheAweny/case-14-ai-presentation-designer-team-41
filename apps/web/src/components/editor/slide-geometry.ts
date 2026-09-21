import type { Box, Grid } from '@lct/contracts';

/** A box in the rendered slide, in CSS pixels, origin at the slide's top left. */
export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

/** The grid in the same EMU space as this slide. A mismatch is scaled, not assumed away. */
export function gridForSlide(grid: Grid, slideCx: number, slideCy: number): Grid {
  if (grid.slideCx === slideCx && grid.slideCy === slideCy) return grid;
  const sx = slideCx / grid.slideCx;
  const sy = slideCy / grid.slideCy;
  return {
    ...grid,
    slideCx,
    slideCy,
    marginLeft: Math.round(grid.marginLeft * sx),
    marginRight: Math.round(grid.marginRight * sx),
    marginTop: Math.round(grid.marginTop * sy),
    marginBottom: Math.round(grid.marginBottom * sy),
    gutter: Math.round(grid.gutter * sx),
    baseline: Math.max(1, Math.round(grid.baseline * sy)),
  };
}

export function pixelBoxToEmu(
  box: PixelBox,
  frame: FrameSize,
  slideCx: number,
  slideCy: number,
): Box {
  if (frame.width <= 0 || frame.height <= 0) return { x: 0, y: 0, cx: 0, cy: 0 };
  return {
    x: Math.round((box.x / frame.width) * slideCx),
    y: Math.round((box.y / frame.height) * slideCy),
    cx: Math.max(0, Math.round((box.width / frame.width) * slideCx)),
    cy: Math.max(0, Math.round((box.height / frame.height) * slideCy)),
  };
}

function emuToPx(emu: number, slideEmu: number, framePx: number): number {
  if (slideEmu <= 0) return 0;
  return (emu / slideEmu) * framePx;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
}

/** Column edges, including both sides of each gutter. */
function columnEdges(grid: Grid): number[] {
  const content = grid.slideCx - grid.marginLeft - grid.marginRight;
  if (grid.columns <= 0 || content <= 0) return [];
  const column = (content - grid.gutter * (grid.columns - 1)) / grid.columns;
  const edges: number[] = [];
  let x = grid.marginLeft;
  for (let index = 0; index < grid.columns; index += 1) {
    edges.push(x);
    x += column;
    edges.push(x);
    if (index < grid.columns - 1) x += grid.gutter;
  }
  return edges;
}

/**
 * Snap lines in CSS pixels of a frame showing this slide: slide edges, margins, columns,
 * gutters and every baseline between the vertical margins.
 */
export function gridGuidelines(
  grid: Grid,
  frame: FrameSize,
): { vertical: number[]; horizontal: number[] } {
  const vertical = uniqueSorted(
    [0, grid.marginLeft, grid.slideCx - grid.marginRight, grid.slideCx, ...columnEdges(grid)].map(
      (emu) => emuToPx(emu, grid.slideCx, frame.width),
    ),
  );
  const bottom = grid.slideCy - grid.marginBottom;
  const rows = [0, grid.marginTop, bottom, grid.slideCy];
  if (grid.baseline > 0) {
    for (let y = grid.marginTop; y <= bottom; y += grid.baseline) rows.push(y);
  }
  const horizontal = uniqueSorted(rows.map((emu) => emuToPx(emu, grid.slideCy, frame.height)));
  return { vertical, horizontal };
}

/**
 * Keep a box inside the grid margins when it fits there. A shape larger than the content area
 * stays on the slide instead of being shrunk.
 */
export function clampToMargins(box: Box, grid: Grid): Box {
  const minX = grid.marginLeft;
  const minY = grid.marginTop;
  const maxX = grid.slideCx - grid.marginRight;
  const maxY = grid.slideCy - grid.marginBottom;
  const contentW = Math.max(maxX - minX, 0);
  const contentH = Math.max(maxY - minY, 0);
  let { x, y, cx, cy } = box;
  cx = Math.max(0, cx);
  cy = Math.max(0, cy);
  if (cx <= contentW) {
    if (x < minX) x = minX;
    if (x + cx > maxX) x = maxX - cx;
  } else {
    if (x < 0) x = 0;
    if (x + cx > grid.slideCx) x = Math.max(0, grid.slideCx - cx);
  }
  if (cy <= contentH) {
    if (y < minY) y = minY;
    if (y + cy > maxY) y = maxY - cy;
  } else {
    if (y < 0) y = 0;
    if (y + cy > grid.slideCy) y = Math.max(0, grid.slideCy - cy);
  }
  return { x: Math.round(x), y: Math.round(y), cx: Math.round(cx), cy: Math.round(cy) };
}

export function fitsInMargins(box: Box, grid: Grid): boolean {
  const contentW = grid.slideCx - grid.marginLeft - grid.marginRight;
  const contentH = grid.slideCy - grid.marginTop - grid.marginBottom;
  return box.cx <= contentW && box.cy <= contentH;
}

/** One arrow key: a single baseline step, then back inside the margins. */
export function nudgeByBaseline(box: Box, direction: ArrowDirection, grid: Grid): Box {
  const step = grid.baseline;
  const next = { ...box };
  if (direction === 'left') next.x -= step;
  if (direction === 'right') next.x += step;
  if (direction === 'up') next.y -= step;
  if (direction === 'down') next.y += step;
  return clampToMargins(next, grid);
}

export function arrowDirection(code: string): ArrowDirection | null {
  switch (code) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}
