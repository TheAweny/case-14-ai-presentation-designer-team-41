import type { AuditFinding, LayoutVariantName, Severity } from '@lct/contracts';
import { CHECKS } from './checks.js';
import type { AuditIssue, AuditLevel } from './types.js';

/** The two levels on the contract's scale: an error is output that is simply wrong. */
export const SEVERITY_OF_LEVEL: Record<AuditLevel, Severity> = {
  error: 'blocker',
  warning: 'minor',
};

/** A contract severity read as one of the two levels the interface shows. */
export function levelOf(severity: Severity): AuditLevel {
  return severity === 'blocker' || severity === 'major' ? 'error' : 'warning';
}

function paramText(params: AuditIssue['params']): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

/**
 * An issue as the run report records it. The interface localises issues from `checkId`, `kind`
 * and `params`; the text written here is for the report and the logs.
 */
export function toAuditFinding(issue: AuditIssue, variant: LayoutVariantName): AuditFinding {
  const check = CHECKS.find((entry) => entry.id === issue.checkId);
  const title = check?.title ?? issue.checkId;
  const measured = paramText(issue.params);
  return {
    schemaVersion: 1,
    findingId: issue.issueId,
    checkId: issue.checkId,
    origin: 'deterministic',
    severity: SEVERITY_OF_LEVEL[issue.level],
    confidence: 1,
    title,
    detail: `${title}: ${issue.kind}${measured ? ` (${measured})` : ''}.`,
    target: { slideId: issue.slideId, variant, elementId: issue.elementId, box: issue.box },
    evidence: {
      measured,
      expected: check?.description ?? '',
      quote: '',
      sources: [],
      screenshot: '',
    },
    fixability: issue.fixability,
    proposedPatch: issue.fix
      ? {
          patchId: `fix:${issue.issueId}`,
          findingId: issue.issueId,
          slideId: issue.slideId,
          variant,
          ops: [...issue.fix],
          rationale: `Fixes: ${title}.`,
          touchesCopy: false,
        }
      : null,
  };
}
