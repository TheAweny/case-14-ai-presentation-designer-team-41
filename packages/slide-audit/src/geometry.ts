import type { Box } from '@lct/contracts';

/**
 * Plane geometry in slide EMU, y pointing down. An element is a rectangle turned about its
 * centre, so outlines are convex quadrilaterals and exact intersection needs no more than
 * clipping one convex polygon by another.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Polygon = readonly Point[];

/** Corners of a box turned clockwise by `rotation` degrees about its centre. */
export function outline(box: Box, rotation = 0): Polygon {
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.cx, y: box.y },
    { x: box.x + box.cx, y: box.y + box.cy },
    { x: box.x, y: box.y + box.cy },
  ];
  if (rotation % 360 === 0) return corners;
  const cx = box.x + box.cx / 2;
  const cy = box.y + box.cy / 2;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return corners.map(({ x, y }) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
}

/** Every side of a polygon as a pair of consecutive corners, the last closing the loop. */
function sides(polygon: Polygon): (readonly [Point, Point])[] {
  return polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length] ?? a] as const);
}

/** Twice the signed area: positive when the corners run one way, negative the other. */
function twiceSigned(polygon: Polygon): number {
  return sides(polygon).reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0);
}

/** Unsigned area by the shoelace formula. */
export function area(polygon: Polygon): number {
  return Math.abs(twiceSigned(polygon)) / 2;
}

/** Part of `subject` inside the convex `clip` (Sutherland–Hodgman). Empty when they miss. */
export function intersect(subject: Polygon, clip: Polygon): Polygon {
  // The sign of the winding, so clipping works whichever way the corners run.
  const turn = Math.sign(twiceSigned(clip));
  if (turn === 0 || area(subject) === 0) return [];
  let output: Point[] = [...subject];
  for (const [a, b] of sides(clip)) {
    if (output.length === 0) break;
    const inside = (p: Point) =>
      turn * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= 0;
    const input = output;
    output = [];
    for (const [previous, current] of sides(input)) {
      if (inside(current)) {
        if (!inside(previous)) output.push(crossing(previous, current, a, b));
        output.push(current);
      } else if (inside(previous)) {
        output.push(crossing(previous, current, a, b));
      }
    }
  }
  return output;
}

/** Where segment p→q meets the line through a and b. */
function crossing(p: Point, q: Point, a: Point, b: Point): Point {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denominator = dx * ey - dy * ex;
  if (denominator === 0) return q;
  const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / denominator;
  return { x: p.x + t * dx, y: p.y + t * dy };
}

/** The axis-aligned box around a polygon, in whole EMU. */
export function bounds(polygon: Polygon): Box {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  return {
    x,
    y,
    cx: Math.ceil(Math.max(...xs)) - x,
    cy: Math.ceil(Math.max(...ys)) - y,
  };
}

export function centre(polygon: Polygon): Point {
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}
