import type { SlideElement, SlideIr } from '@lct/contracts';
import { EMU_PER_PT } from '@lct/slide-renderer';
import { area, intersect, outline } from './geometry.js';
import type { AuditIssue } from './types.js';

/**
 * Least overshoot worth a word, in EMU. A text line rounds to a fraction of a pixel on screen, and
 * two boxes snapped edge to edge share a hairline; neither is a defect.
 */
export const TOLERANCE_EMU = 2 * EMU_PER_PT;

type IssueFields = Omit<AuditIssue, 'issueId' | 'relatedIds' | 'params' | 'fix'> &
  Partial<Pick<AuditIssue, 'relatedIds' | 'params' | 'fix'>>;

/** An issue with its id derived from what it is about, so it survives unrelated edits. */
export function issue(fields: IssueFields): AuditIssue {
  const relatedIds = fields.relatedIds ?? [];
  const issueId = [
    fields.checkId,
    fields.kind,
    fields.slideId,
    fields.elementId ?? '',
    ...relatedIds,
  ].join(':');
  return { ...fields, issueId, relatedIds, params: fields.params ?? {}, fix: fields.fix ?? null };
}

/** Points, rounded to a tenth, for a message. */
export function pt(emu: number): number {
  return Math.round((emu / EMU_PER_PT) * 10) / 10;
}

/** Whether two elements were grouped by a person, who then arranged them together on purpose. */
export function shareGroup(a: SlideElement, b: SlideElement): boolean {
  const groups = new Set(a.groupIds ?? []);
  return (b.groupIds ?? []).some((id) => groups.has(id));
}

/** The element of a layout placed from the same template shape, if any. */
export function layoutTwin(
  layout: SlideIr | undefined,
  element: SlideElement,
): SlideElement | undefined {
  if (!layout || element.sourceShapeId === null) return undefined;
  return layout.elements.find((other) => other.sourceShapeId === element.sourceShapeId);
}

/** Two template shapes that already overlap in the template's own layout. */
export function overlapInLayout(
  layout: SlideIr | undefined,
  a: SlideElement,
  b: SlideElement,
): boolean {
  const twinA = layoutTwin(layout, a);
  const twinB = layoutTwin(layout, b);
  if (!twinA || !twinB) return false;
  const shared = intersect(
    outline(twinA.box, twinA.rotation ?? 0),
    outline(twinB.box, twinB.rotation ?? 0),
  );
  return shared.length >= 3 && area(shared) > 0;
}
