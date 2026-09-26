import type { SlideElement, SlideIr } from '@lct/contracts';
import { decorFill, slideSizeOf } from '@lct/slide-renderer';
import { area, bounds, intersect, type Polygon } from '../geometry.js';
import { TOLERANCE_EMU, issue, overlapInLayout, shareGroup } from '../issue.js';
import { footprint, isContent } from '../text.js';
import { relocate, safeArea } from '../placement.js';
import type { AuditContext, AuditIssue, AuditLevel } from '../types.js';

/** Share of the smaller outline that counts as lying wholly on the other: a caption on a photo. */
const WHOLLY_ON = 0.98;
/** Share of content a filled shape has to hide before it reads as covering it. */
const COVERED = 0.2;
/** A shape fainter than this lets the content under it through. */
const OPAQUE_ENOUGH = 0.5;

type Verdict = { readonly kind: string; readonly level: AuditLevel } | null;

/**
 * Whether an overlap of two content elements is a defect.
 *
 * A picture is the one element designed to carry others: a caption or a logo lying wholly on a
 * photo is a layout, the same caption hanging off its edge is not. Everything else overlapping is
 * two things competing for the same place.
 */
function judge(
  lower: SlideElement,
  upper: SlideElement,
  shared: number,
  a: number,
  b: number,
): Verdict {
  const lowerIsPicture = lower.kind === 'image';
  const upperIsPicture = upper.kind === 'image';
  if (lowerIsPicture && upperIsPicture) {
    return shared >= WHOLLY_ON * Math.min(a, b) ? null : { kind: 'pictures', level: 'warning' };
  }
  if (lowerIsPicture || upperIsPicture) {
    const other = lowerIsPicture ? b : a;
    return shared >= WHOLLY_ON * other ? null : { kind: 'picture-edge', level: 'error' };
  }
  return { kind: 'content', level: 'error' };
}

/**
 * Elements that overlap where nobody meant them to, and filled shapes painted over content.
 * Outlines are exact, rotation included; text is the height of its words, not of its box.
 */
export function checkElementOverlap(slide: SlideIr, context: AuditContext): AuditIssue[] {
  const layout = context.layoutFor?.(slide.patternId);
  const size = slideSizeOf(slide);
  const outlines = new Map<string, Polygon>();
  const outlineOf = (element: SlideElement) => {
    let polygon = outlines.get(element.elementId);
    if (!polygon) {
      polygon = footprint(element, slide.slideId, context);
      outlines.set(element.elementId, polygon);
    }
    return polygon;
  };

  const issues: AuditIssue[] = [];
  const { elements } = slide;
  for (const [i, lower] of elements.entries()) {
    if (!isContent(lower)) continue;
    for (const upper of elements.slice(i + 1)) {
      if (shareGroup(lower, upper) || overlapInLayout(layout, lower, upper)) continue;
      const covering = upper.kind === 'decor';
      if (!covering && !isContent(upper)) continue;
      if (covering) {
        const fill = decorFill(upper, size, context.designSystem);
        if (fill === null || (upper.opacity ?? 1) < OPAQUE_ENOUGH) continue;
      }

      const a = outlineOf(lower);
      const b = outlineOf(upper);
      const shared = intersect(a, b);
      if (shared.length < 3) continue;
      const box = bounds(shared);
      if (Math.min(box.cx, box.cy) < TOLERANCE_EMU) continue;

      const sharedArea = area(shared);
      const verdict: Verdict = covering
        ? sharedArea >= COVERED * area(a)
          ? { kind: 'covered', level: 'error' }
          : null
        : judge(lower, upper, sharedArea, area(a), area(b));
      if (!verdict) continue;

      // Moving the upper element aside fixes an overlap of content. A shape over content is
      // decoration out of place, which is the author's call, not geometry's.
      const fix = covering ? null : relocate(slide, upper, safeArea(slide, context), context);
      issues.push(
        issue({
          checkId: 'element-overlap',
          kind: verdict.kind,
          level: verdict.level,
          slideId: slide.slideId,
          elementId: upper.elementId,
          relatedIds: [lower.elementId],
          box,
          fix,
          fixability: fix ? 'auto' : 'manual',
        }),
      );
    }
  }
  return issues;
}
