import type { Box, DesignSystem, Fixability, PatchOp, SlideIr } from '@lct/contracts';
import type { CheckId } from './checks.js';

/**
 * Two levels, because a person reading the audit acts on two: an error breaks the slide as
 * shown or exported, a warning is worth a look. The contract's four severities are for the
 * engine report; `toAuditFinding` maps these two onto it.
 */
export type AuditLevel = 'error' | 'warning';

/**
 * One problem with one slide, in the shape the editor draws and localises.
 *
 * `params` carries the numbers a message is built from, so the interface can phrase it in its
 * own language instead of showing a sentence written here. Lengths are in EMU, ratios as they are.
 */
export interface AuditIssue {
  /** Stable while the problem persists: the same overlap keeps its id across edits. */
  readonly issueId: string;
  readonly checkId: CheckId;
  /** Which of the ways a check can fail, such as `text-text` or `covered` for an overlap. */
  readonly kind: string;
  readonly level: AuditLevel;
  readonly slideId: string;
  /** Null when the problem belongs to the slide as a whole. */
  readonly elementId: string | null;
  /** Other elements involved, such as the one an element overlaps. */
  readonly relatedIds: readonly string[];
  /** Where to draw the problem, in EMU. Null when it has no place on the slide. */
  readonly box: Box | null;
  readonly params: Readonly<Record<string, number | string>>;
  readonly fixability: Fixability;
  /** Ops that fix it without a model, applied together. Null when there are none. */
  readonly fix: readonly PatchOp[] | null;
}

/**
 * Thresholds of one audit profile. The defaults are the `default` profile of
 * `configs/audit.yaml`; a test keeps the two in step.
 */
export interface AuditProfile {
  /** Contrast normal text needs. Large text needs the WCAG 3:1 whatever this says. */
  readonly minContrastRatio: number;
  /** Least margin when the template grid could not be measured, in points. */
  readonly minMarginPt: number;
  /** Case-insensitive strings that must never reach a reader. */
  readonly forbiddenPatterns: readonly string[];
}

/**
 * What the audit needs besides the slides. Measurements the audit cannot take itself come in as
 * functions, so the same checks run in a browser, which can measure type, and in a test, which
 * states the numbers.
 */
export interface AuditContext {
  readonly designSystem: DesignSystem;
  readonly profile?: Partial<AuditProfile>;
  /**
   * Height the text of an element takes when set, in EMU, or undefined when it was not measured.
   * Without a measurement the audit falls back on the overflow the layout recorded.
   */
  readonly textHeight?: (slideId: string, elementId: string) => number | undefined;
  /** Whether a typeface is missing where the deck is shown. Absent: every typeface is there. */
  readonly isFontMissing?: (family: string) => boolean;
  /**
   * The template layout a slide was built on, by pattern id. Two template shapes that overlap
   * in their own layout overlap on purpose.
   */
  readonly layoutFor?: (patternId: string) => SlideIr | undefined;
}
