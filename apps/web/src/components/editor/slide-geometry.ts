import type { Box, Grid } from '@lct/contracts';
import { EMU_PER_CSS_PX } from './zoom-input';

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
 * Snap lines in pixels of a frame showing this slide: slide edges and centre, margins, columns
 * and gutters. Baselines are not guides: at a few pixels apart they would catch every move.
 * `origin` is where the frame's top left sits in the pixels the guides are drawn in.
 */
export function gridGuidelines(
  grid: Grid,
  frame: FrameSize,
  origin: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): { vertical: number[]; horizontal: number[] } {
  const vertical = uniqueSorted(
    [
      0,
      grid.marginLeft,
      grid.slideCx / 2,
      grid.slideCx - grid.marginRight,
      grid.slideCx,
      ...columnEdges(grid),
    ].map((emu) => origin.x + emuToPx(emu, grid.slideCx, frame.width)),
  );
  const horizontal = uniqueSorted(
    [0, grid.marginTop, grid.slideCy / 2, grid.slideCy - grid.marginBottom, grid.slideCy].map(
      (emu) => origin.y + emuToPx(emu, grid.slideCy, frame.height),
    ),
  );
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

/** Shift+arrow moves this many baselines at once. */
export const LARGE_NUDGE_BASELINES = 4;

/**
 * One arrow key: exactly one step in the arrow's direction and nowhere else. The step is the
 * baseline, the same length across as down, and `large` is the Shift step. Margins are guides,
 * not walls: a box in the margin or past the slide edge moves like any other.
 */
export function nudgeBox(box: Box, direction: ArrowDirection, grid: Grid, large = false): Box {
  const step = Math.max(1, grid.baseline) * (large ? LARGE_NUDGE_BASELINES : 1);
  const next = { ...box };
  if (direction === 'left') next.x -= step;
  if (direction === 'right') next.x += step;
  if (direction === 'up') next.y -= step;
  if (direction === 'down') next.y += step;
  return next;
}

/** One arrow key without Shift. */
export function nudgeByBaseline(box: Box, direction: ArrowDirection, grid: Grid): Box {
  return nudgeBox(box, direction, grid);
}

/** A drag, as the gesture reports it: the translate in pixels of the slide frame. */
export function translatedBox(
  box: Box,
  translate: readonly [number, number] | readonly number[],
  frame: FrameSize,
  slideCx: number,
  slideCy: number,
): Box {
  if (frame.width <= 0 || frame.height <= 0) return box;
  const [dx = 0, dy = 0] = translate;
  return {
    ...box,
    x: Math.round(box.x + (dx / frame.width) * slideCx),
    y: Math.round(box.y + (dy / frame.height) * slideCy),
  };
}

export interface ResizeDelta {
  /** Change of width and height in frame pixels. */
  readonly dist: readonly number[];
  /** The handle: -1 left or top, 1 right or bottom, 0 the middle of that side. */
  readonly direction: readonly number[];
  /** Where the box moved while it grew, in frame pixels. */
  readonly translate: readonly number[];
}

function resizedAxis(
  start: number,
  size: number,
  dist: number,
  direction: number,
  translate: number,
  pxToEmu: number,
  anchored: boolean,
): { start: number; size: number } {
  // No change on this axis: the EMU size stays exactly as it was, whatever pixels said.
  const next = dist === 0 ? size : Math.max(1, Math.round(size + dist * pxToEmu));
  if (!anchored) return { start: Math.round(start + translate * pxToEmu), size: next };
  if (direction > 0) return { start, size: next };
  if (direction < 0) return { start: start + size - next, size: next };
  return { start: Math.round(start + (size - next) / 2), size: next };
}

/**
 * A resize, from the box it started with and the change the gesture reports. The box is never
 * measured back from the screen, so repeated resizes do not drift. A single box keeps the side
 * opposite the handle fixed in EMU; boxes of a group move by their own translate.
 */
export function resizedBox(
  box: Box,
  delta: ResizeDelta,
  frame: FrameSize,
  slideCx: number,
  slideCy: number,
  anchored = true,
): Box {
  if (frame.width <= 0 || frame.height <= 0) return box;
  const x = resizedAxis(
    box.x,
    box.cx,
    delta.dist[0] ?? 0,
    delta.direction[0] ?? 0,
    delta.translate[0] ?? 0,
    slideCx / frame.width,
    anchored,
  );
  const y = resizedAxis(
    box.y,
    box.cy,
    delta.dist[1] ?? 0,
    delta.direction[1] ?? 0,
    delta.translate[1] ?? 0,
    slideCy / frame.height,
    anchored,
  );
  return { x: x.start, y: y.start, cx: x.size, cy: y.size };
}

/** A distance on screen, in pixels of the slide at 100 %, for the snap labels. */
export function slidePixels(screenPx: number, frameWidthPx: number, slideCx: number): number {
  if (frameWidthPx <= 0) return 0;
  return Math.round(((screenPx / frameWidthPx) * slideCx) / EMU_PER_CSS_PX);
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

/** The smallest box around all of these. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.cx));
  const bottom = Math.max(...boxes.map((box) => box.y + box.cy));
  return { x: left, y: top, cx: right - left, cy: bottom - top };
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/**
 * Line boxes up on one edge or axis of their common bounds. Boxes already in place are left
 * out, so the journal records only what moved.
 */
export function alignBoxes(
  items: readonly { readonly elementId: string; readonly box: Box }[],
  alignment: Alignment,
): { elementId: string; box: Box }[] {
  const bounds = unionBox(items.map((item) => item.box));
  if (!bounds || items.length < 2) return [];
  const right = bounds.x + bounds.cx;
  const bottom = bounds.y + bounds.cy;
  return items.flatMap(({ elementId, box }) => {
    const next = { ...box };
    if (alignment === 'left') next.x = bounds.x;
    if (alignment === 'center') next.x = Math.round(bounds.x + (bounds.cx - box.cx) / 2);
    if (alignment === 'right') next.x = right - box.cx;
    if (alignment === 'top') next.y = bounds.y;
    if (alignment === 'middle') next.y = Math.round(bounds.y + (bounds.cy - box.cy) / 2);
    if (alignment === 'bottom') next.y = bottom - box.cy;
    return next.x === box.x && next.y === box.y ? [] : [{ elementId, box: next }];
  });
}

export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Space boxes out evenly along an axis, as Figma's "distribute spacing" does: the first and the
 * last stay where they are, and every gap between neighbours becomes the same. Boxes are taken
 * in the order they start on the axis. With fewer than three there is only one gap, so nothing
 * moves; boxes already in place are left out, so the journal records only what moved.
 */
export function distributeBoxes(
  items: readonly { readonly elementId: string; readonly box: Box }[],
  axis: DistributeAxis,
): { elementId: string; box: Box }[] {
  if (items.length < 3) return [];
  const start = axis === 'horizontal' ? 'x' : 'y';
  const size = axis === 'horizontal' ? 'cx' : 'cy';
  const sorted = [...items].sort(
    (left, right) =>
      left.box[start] - right.box[start] ||
      left.box[start] + left.box[size] - (right.box[start] + right.box[size]),
  );
  const first = sorted[0];
  if (!first) return [];
  const from = first.box[start];
  const to = Math.max(...sorted.map(({ box }) => box[start] + box[size]));
  const occupied = sorted.reduce((sum, { box }) => sum + box[size], 0);
  const gap = (to - from - occupied) / (sorted.length - 1);
  let cursor = from;
  return sorted.flatMap(({ elementId, box }) => {
    const at = Math.round(cursor);
    cursor += box[size] + gap;
    return at === box[start] ? [] : [{ elementId, box: { ...box, [start]: at } }];
  });
}

/**
 * The box a rotated element covers on the slide: its own box turned about the centre, then
 * bounded again. Anything placed next to the element, like the property bar, has to clear this.
 */
export function rotatedBounds(box: Box, rotation = 0): Box {
  const turn = (((rotation % 180) + 180) % 180) * (Math.PI / 180);
  if (turn === 0) return box;
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const cx = box.cx * cos + box.cy * sin;
  const cy = box.cx * sin + box.cy * cos;
  return {
    x: Math.round(box.x + (box.cx - cx) / 2),
    y: Math.round(box.y + (box.cy - cy) / 2),
    cx: Math.round(cx),
    cy: Math.round(cy),
  };
}

/**
 * Where the selection's property bar goes, in the same pixels as the boxes: centred over the
 * selection, below it when there is no room above, and never outside the visible area.
 */
export function placeSelectionBar(
  selection: PixelBox,
  bar: FrameSize,
  area: PixelBox,
  gap: number,
): { x: number; y: number; below: boolean } {
  const minX = area.x + gap;
  const maxX = Math.max(minX, area.x + area.width - gap - bar.width);
  const x = Math.min(Math.max(selection.x + (selection.width - bar.width) / 2, minX), maxX);
  const above = selection.y - gap - bar.height;
  if (above >= area.y + gap) return { x: Math.round(x), y: Math.round(above), below: false };
  const minY = area.y + gap;
  const maxY = Math.max(minY, area.y + area.height - gap - bar.height);
  const below = Math.min(Math.max(selection.y + selection.height + gap, minY), maxY);
  return { x: Math.round(x), y: Math.round(below), below: true };
}
