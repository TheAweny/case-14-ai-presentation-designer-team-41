import type { AuditFinding } from '@lct/contracts';

/** What the slot rewriter is asked to change in one slot of one slide. */
export interface SlotCorrection {
  /** Zero-based position of the slide in the deck. */
  index: number;
  slotId: string;
  message: string;
}

/** The part of a written slide the review needs: its copy by slot. */
export interface WrittenCopy {
  index: number;
  slide: { texts: readonly { slotId: string; text: string }[] };
}

/**
 * Contextual checks a rewrite of one slot's copy can answer. The others ask about the shape of
 * the slide (one idea, repeats, pictures), which new wording does not change.
 */
const REWRITABLE = new Set([
  'headline-states-conclusion',
  'slide-title-matches-body',
  'no-typos',
  'no-service-text',
  'claim-supported-by-content-pack',
]);
/** A model less sure than this is not trusted to send copy back for a rewrite. */
const MIN_CONFIDENCE = 0.8;
/** Corrections per slide: a slide that fails more is for its author, not for another rewrite. */
const MAX_PER_SLIDE = 3;
/** The shortest quote that points at one slot rather than at any of them. */
const MIN_QUOTE = 4;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The zero-based slide a finding is about: `s3` and `imported-3` are both the third. */
export function slideIndexOf(slideId: string): number | null {
  const number = /(\d+)$/.exec(slideId)?.[1];
  return number === undefined ? null : Number(number) - 1;
}

/**
 * Slots to send to the rewriter for what the model saw in the picture of the slides. A finding
 * is taken only when the model is sure and the text it quoted is found in exactly one slot of its
 * slide: that is the only way to tell which copy to change.
 */
export function contextualCorrections(
  findings: readonly AuditFinding[],
  written: readonly WrittenCopy[],
): SlotCorrection[] {
  const corrections: SlotCorrection[] = [];
  const perSlide = new Map<number, number>();
  for (const finding of findings) {
    if (
      finding.origin !== 'contextual' ||
      finding.severity === 'info' ||
      finding.confidence < MIN_CONFIDENCE ||
      !REWRITABLE.has(finding.checkId)
    ) {
      continue;
    }
    const index = slideIndexOf(finding.target.slideId);
    const quote = squash(finding.evidence.quote);
    if (index === null || quote.length < MIN_QUOTE) continue;
    if ((perSlide.get(index) ?? 0) >= MAX_PER_SLIDE) continue;
    const slots = written
      .find((slide) => slide.index === index)
      ?.slide.texts.filter((text) => squash(text.text).includes(quote));
    const [slot, ...others] = slots ?? [];
    if (slot === undefined || others.length > 0) continue;
    if (corrections.some((c) => c.index === index && c.slotId === slot.slotId)) continue;
    perSlide.set(index, (perSlide.get(index) ?? 0) + 1);
    const wording = finding.detail.trim();
    corrections.push({
      index,
      slotId: slot.slotId,
      message:
        `${finding.title}: «${finding.evidence.quote.trim()}».` +
        (wording && wording !== finding.evidence.expected ? ` Подсказка: ${wording}` : ''),
    });
  }
  return corrections;
}

/** One round of the self-check, as it is kept next to the deck. */
export interface SelfCheckRound {
  round: number;
  /** What the audits found before the round, by source. */
  found: { deterministic: number; contextual: number };
  /** Slots sent to the rewriter, and which audit asked for each. */
  corrected: { slide: number; slotId: string; source: 'deterministic' | 'contextual' }[];
  /** What the audits found after it. Null when the round was not re-checked. */
  after: { deterministic: number; contextual: number } | null;
}

/** Findings that ask the user for attention: the blockers and majors. */
export function needsAttention(findings: readonly AuditFinding[]): AuditFinding[] {
  return findings.filter((f) => f.severity === 'blocker' || f.severity === 'major');
}
