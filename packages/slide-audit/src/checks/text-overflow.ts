import type { SlideIr } from '@lct/contracts';
import { EMU_PER_PT } from '@lct/slide-renderer';
import { bounds, outline } from '../geometry.js';
import { issue, pt } from '../issue.js';
import { isBlank, runLook, textBox, type TextElement } from '../text.js';
import type { AuditContext, AuditIssue } from '../types.js';

/**
 * Share of the type size a line box may reach past the frame with no letter crossing it: the
 * leading under the last line and the room kept for descenders. Measured in a browser, a line box
 * runs a point or two past a frame the letters fit in, and that is not overflow anybody can see.
 */
const LEADING_SHARE = 0.2;

/** Least overflow worth a word, in EMU: a fifth of the largest type in the element, one point at least. */
function toleranceOf(element: TextElement, context: AuditContext, slideCy: number): number {
  let largest = 0;
  for (const paragraph of element.paragraphs) {
    for (const run of paragraph.runs) {
      if (run.text.trim() === '') continue;
      largest = Math.max(largest, runLook(run, element, context.designSystem, slideCy).sizePt);
    }
  }
  return Math.max(EMU_PER_PT, LEADING_SHARE * largest * EMU_PER_PT);
}

/**
 * Text taller than its box. The words are never cut: past the box they run over whatever lies
 * there on the slide, and the export shows them the same way.
 */
export function checkTextOverflow(slide: SlideIr, context: AuditContext): AuditIssue[] {
  const issues: AuditIssue[] = [];
  for (const element of slide.elements) {
    if (element.kind !== 'text' || isBlank(element.paragraphs)) continue;
    const measured = context.textHeight?.(slide.slideId, element.elementId);
    const overflow =
      measured !== undefined ? measured - element.box.cy : (element.overflow?.emu ?? 0);
    if (!(overflow > toleranceOf(element, context, slide.slideCy))) continue;

    const text = textBox(element, slide.slideId, context);
    const box = bounds([
      ...outline(element.box, element.rotation ?? 0),
      ...outline(text, element.rotation ?? 0),
    ]);
    issues.push(
      issue({
        checkId: 'text-overflow',
        kind: 'text',
        level: 'error',
        slideId: slide.slideId,
        elementId: element.elementId,
        box,
        params: { overflowPt: pt(overflow), boxPt: pt(element.box.cy) },
        fixability: 'assisted',
      }),
    );
  }
  return issues;
}
