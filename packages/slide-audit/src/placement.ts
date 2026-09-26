import type { Box, PatchOp, SlideElement, SlideIr } from '@lct/contracts';
import { EMU_PER_PT } from '@lct/slide-renderer';
import { bounds, outline } from './geometry.js';
import { TOLERANCE_EMU, overlapInLayout, shareGroup } from './issue.js';
import { profileOf } from './profile.js';
import { footprint, isContent } from './text.js';
import type { AuditContext } from './types.js';

/**
 * Where a fix may put an element. A fix is geometry, not taste: the nearest place inside the
 * template margins where the element covers no other content. When there is no such place there
 * is no fix, rather than a move that trades one problem for another.
 */

export interface Area {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function slideArea(slide: SlideIr): Area {
  return { left: 0, top: 0, right: slide.slideCx, bottom: slide.slideCy };
}

/** The part of the slide the template keeps its content in. */
export function safeArea(slide: SlideIr, context: AuditContext): Area {
  const { grid } = context.designSystem;
  const measured = grid.meta.source !== 'fallback';
  const fallback = profileOf(context.profile).minMarginPt * EMU_PER_PT;
  return {
    left: measured ? grid.marginLeft : fallback,
    top: measured ? grid.marginTop : fallback,
    right: slide.slideCx - (measured ? grid.marginRight : fallback),
    bottom: slide.slideCy - (measured ? grid.marginBottom : fallback),
  };
}

function intersects(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.cx + gap - 1 &&
    b.x < a.x + a.cx + gap - 1 &&
    a.y < b.y + b.cy + gap - 1 &&
    b.y < a.y + a.cy + gap - 1
  );
}

/**
 * The nearest top-left corner for a `size` box inside `area` that keeps `gap` clear of every
 * obstacle, or null. Candidates are the area edges, the current place pushed inside, and the
 * sides of every obstacle: an optimal free place always touches one of them on each axis.
 */
export function nearestFreeSpot(
  from: Box,
  area: Area,
  obstacles: readonly Box[],
  gap: number,
): { x: number; y: number } | null {
  const { cx: w, cy: h } = from;
  if (w > area.right - area.left || h > area.bottom - area.top) return null;
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  const xs = [
    clamp(from.x, area.left, area.right - w),
    area.left,
    area.right - w,
    ...obstacles.flatMap((o) => [o.x + o.cx + gap, o.x - w - gap]),
  ].filter((x) => x >= area.left && x + w <= area.right);
  const ys = [
    clamp(from.y, area.top, area.bottom - h),
    area.top,
    area.bottom - h,
    ...obstacles.flatMap((o) => [o.y + o.cy + gap, o.y - h - gap]),
  ].filter((y) => y >= area.top && y + h <= area.bottom);

  let best: { x: number; y: number; distance: number } | null = null;
  for (const x of new Set(xs)) {
    for (const y of new Set(ys)) {
      const distance = (x - from.x) ** 2 + (y - from.y) ** 2;
      if (best && distance >= best.distance) continue;
      const spot = { x, y, cx: w, cy: h };
      if (obstacles.some((o) => intersects(spot, o, gap))) continue;
      best = { x, y, distance };
    }
  }
  return best && { x: best.x, y: best.y };
}

/**
 * A `move` of the element to the nearest free place in `area`, or null when there is none, when
 * the element is locked, or when it is already there.
 */
export function relocate(
  slide: SlideIr,
  element: SlideElement,
  area: Area,
  context: AuditContext,
): PatchOp[] | null {
  if (element.locked) return null;
  const layout = context.layoutFor?.(slide.patternId);
  const obstacles = slide.elements
    .filter(
      (other) =>
        other.elementId !== element.elementId &&
        isContent(other) &&
        !shareGroup(element, other) &&
        !overlapInLayout(layout, element, other),
    )
    .map((other) => bounds(footprint(other, slide.slideId, context)));
  const outer = bounds(outline(element.box, element.rotation ?? 0));
  const gap = Math.max(context.designSystem.grid.gutter, TOLERANCE_EMU);
  const spot = nearestFreeSpot(outer, area, obstacles, gap);
  if (!spot) return null;
  const dx = spot.x - outer.x;
  const dy = spot.y - outer.y;
  if (dx === 0 && dy === 0) return null;
  const { box } = element;
  return [
    { op: 'move', elementId: element.elementId, box: { ...box, x: box.x + dx, y: box.y + dy } },
  ];
}
