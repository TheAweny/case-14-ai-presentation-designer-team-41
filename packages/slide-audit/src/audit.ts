import type { SlideIr } from '@lct/contracts';
import { checkContrast } from './checks/contrast.js';
import { checkElementOverlap } from './checks/element-overlap.js';
import { checkFontUnavailable } from './checks/font-unavailable.js';
import { checkPlaceholderText } from './checks/placeholder-text.js';
import { checkSlideBounds } from './checks/slide-bounds.js';
import { checkTextOverflow } from './checks/text-overflow.js';
import type { AuditContext, AuditIssue } from './types.js';

/**
 * Every per-slide check over one slide. Pure: the same slide and context give the same issues, so
 * a caller can keep the result for as long as the slide object is the same.
 */
export function auditSlide(slide: SlideIr, context: AuditContext): AuditIssue[] {
  return [
    ...checkTextOverflow(slide, context),
    ...checkElementOverlap(slide, context),
    ...checkSlideBounds(slide, context),
    ...checkPlaceholderText(slide, context),
    ...checkContrast(slide, context),
  ];
}

/** Checks that look at the deck as a whole rather than at one slide. */
export function auditDeckWide(slides: readonly SlideIr[], context: AuditContext): AuditIssue[] {
  return checkFontUnavailable(slides, context);
}

/** The whole audit: every slide in order, then the deck-wide issues. */
export function auditDeck(slides: readonly SlideIr[], context: AuditContext): AuditIssue[] {
  return [
    ...slides.flatMap((slide) => auditSlide(slide, context)),
    ...auditDeckWide(slides, context),
  ];
}
