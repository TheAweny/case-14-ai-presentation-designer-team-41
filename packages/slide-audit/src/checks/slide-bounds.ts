import type { Box, SlideElement, SlideIr } from '@lct/contracts';
import { bounds, outline } from '../geometry.js';
import { TOLERANCE_EMU, issue, layoutTwin, pt } from '../issue.js';
import { relocate, safeArea, slideArea, type Area } from '../placement.js';
import { estimatedExtent, footprint, isBlank } from '../text.js';
import type { AuditContext, AuditIssue } from '../types.js';

/** Roles the template itself puts at the very edge of the slide. */
const EDGE_ROLES: ReadonlySet<SlideElement['role']> = new Set(['footer', 'page-number', 'logo']);

/** Text, a table or a chart: what the export cutting off at the edge would lose. */
function isReadable(element: SlideElement): boolean {
  if (element.kind === 'text') return !isBlank(element.paragraphs);
  return element.kind === 'table' || element.kind === 'chart';
}

/** How far the box reaches past the area, on the worst side, in EMU. Zero when inside. */
function overshoot(box: Box, area: Area): number {
  return Math.max(
    area.left - box.x,
    area.top - box.y,
    box.x + box.cx - area.right,
    box.y + box.cy - area.bottom,
    0,
  );
}

/**
 * Content crossing the slide edge, which the export cuts off, and elements lying wholly off the
 * slide, which nobody will see. Pictures and decoration may bleed off the edge: a full-bleed photo
 * is a design, a paragraph missing its last words is not.
 *
 * Content inside the slide but past the template margins is a warning. Elements a template layout
 * put where they are stay out of both checks: the layout is where the margins were measured, and
 * its own shapes may bleed off the edge by design.
 */
export function checkSlideBounds(slide: SlideIr, context: AuditContext): AuditIssue[] {
  const layout = context.layoutFor?.(slide.patternId);
  const whole = slideArea(slide);
  const safe = safeArea(slide, context);
  const issues: AuditIssue[] = [];

  for (const element of slide.elements) {
    // Text is judged by where its words are: the empty end of a wide box may pass the edge.
    // Where no browser measured them, as for a finished run, their width is estimated.
    const outer = bounds(
      element.kind === 'text'
        ? footprint(element, slide.slideId, {
            ...context,
            textExtent: (slideId, elementId) =>
              context.textExtent?.(slideId, elementId) ??
              estimatedExtent(element, context) ??
              undefined,
          })
        : outline(element.box, element.rotation ?? 0),
    );
    const base = { slideId: slide.slideId, elementId: element.elementId, box: outer };
    // What the template layout itself puts there is its design, even past the edge: a giant
    // quotation mark bleeding off the top is drawn so on purpose.
    const twin = layoutTwin(layout, element);
    if (twin && sameBox(twin.box, element.box)) continue;

    const outside =
      outer.x >= whole.right ||
      outer.y >= whole.bottom ||
      outer.x + outer.cx <= 0 ||
      outer.y + outer.cy <= 0;
    if (outside) {
      const fix =
        relocate(slide, element, safe, context) ?? relocate(slide, element, whole, context);
      issues.push(
        issue({
          ...base,
          checkId: 'off-slide',
          kind: 'outside',
          level: 'warning',
          fix,
          fixability: fix ? 'auto' : 'manual',
        }),
      );
      continue;
    }
    if (!isReadable(element)) continue;

    const past = overshoot(outer, whole);
    if (past > TOLERANCE_EMU) {
      const fix =
        relocate(slide, element, safe, context) ?? relocate(slide, element, whole, context);
      issues.push(
        issue({
          ...base,
          checkId: 'off-slide',
          kind: 'edge',
          level: 'error',
          params: { pastPt: pt(past) },
          fix,
          fixability: fix ? 'auto' : 'manual',
        }),
      );
      continue;
    }

    if (EDGE_ROLES.has(element.role)) continue;
    const beyondMargin = overshoot(outer, safe);
    if (beyondMargin > TOLERANCE_EMU) {
      const fix = relocate(slide, element, safe, context);
      issues.push(
        issue({
          ...base,
          checkId: 'safe-margins',
          kind: 'margin',
          level: 'warning',
          params: { pastPt: pt(beyondMargin) },
          fix,
          fixability: fix ? 'auto' : 'manual',
        }),
      );
    }
  }
  return issues;
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.cx === b.cx && a.cy === b.cy;
}
