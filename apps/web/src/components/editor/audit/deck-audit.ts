import type { DesignSystem, PatchOp, SlideIr } from '@lct/contracts';
import { commitMoves, commitRemove, commitSetColor } from '@lct/deck-ops';
import type { AuditIssue } from '@lct/slide-audit';
import type { Commit } from '@/components/editor/use-deck-history';

/**
 * Что редактор делает с находками аудита, без React: считает их по слайдам, выстраивает в
 * порядке чтения и превращает предложенное исправление в правку колоды.
 */

export interface AuditCounts {
  readonly errors: number;
  readonly warnings: number;
}

export const NO_ISSUES: AuditCounts = { errors: 0, warnings: 0 };

function add(counts: AuditCounts, issue: AuditIssue): AuditCounts {
  return issue.level === 'error'
    ? { ...counts, errors: counts.errors + 1 }
    : { ...counts, warnings: counts.warnings + 1 };
}

export function countIssues(issues: readonly AuditIssue[]): AuditCounts {
  return issues.reduce(add, NO_ISSUES);
}

/**
 * Находка про колоду целиком, а не про место на слайде: например, шрифт, которого нет. Она
 * привязана к первому слайду, где встретилась, но значок этого слайда её не считает.
 */
export function isDeckWide(issue: AuditIssue): boolean {
  return issue.checkId === 'font-unavailable';
}

/** Счёт по слайдам без находок про всю колоду; слайда без находок в карте нет. */
export function countBySlide(issues: readonly AuditIssue[]): ReadonlyMap<string, AuditCounts> {
  const counts = new Map<string, AuditCounts>();
  for (const issue of issues) {
    if (isDeckWide(issue)) continue;
    counts.set(issue.slideId, add(counts.get(issue.slideId) ?? NO_ISSUES, issue));
  }
  return counts;
}

/**
 * Порядок чтения: по слайдам колоды, внутри слайда — сначала ошибки, потом сверху вниз и
 * слева направо, как человек и пойдёт их исправлять.
 */
export function sortIssues(
  issues: readonly AuditIssue[],
  slides: readonly Pick<SlideIr, 'slideId'>[],
): AuditIssue[] {
  const order = new Map(slides.map((slide, index) => [slide.slideId, index]));
  const place = (issue: AuditIssue) => order.get(issue.slideId) ?? Number.MAX_SAFE_INTEGER;
  return [...issues].sort(
    (a, b) =>
      place(a) - place(b) ||
      Number(b.level === 'error') - Number(a.level === 'error') ||
      (a.box?.y ?? 0) - (b.box?.y ?? 0) ||
      (a.box?.x ?? 0) - (b.box?.x ?? 0),
  );
}

/** Одна операция исправления как правка колоды; операцию, которой редактор не знает, — null. */
function commitOf(slideId: string, op: PatchOp, designSystem: DesignSystem): Commit | null {
  switch (op.op) {
    case 'move':
      return (slides) =>
        commitMoves(slides, { slideId, moves: [{ elementId: op.elementId, box: op.box }] });
    case 'remove':
      return (slides) => commitRemove(slides, { slideId, elementIds: [op.elementId] });
    case 'set-color': {
      const hex = designSystem.palette.find((entry) => entry.role === op.colorRole)?.hex;
      if (!hex) return null;
      return (slides) =>
        commitSetColor(slides, { slideId, elementId: op.elementId, colorRole: op.colorRole, hex });
    }
    default:
      return null;
  }
}

/**
 * Исправление находки как список правок: применяются вместе и отменяются одним шагом. Null,
 * если исправления нет или редактор не умеет хотя бы одну его операцию — полу-исправлять нельзя.
 */
export function fixCommits(issue: AuditIssue, designSystem: DesignSystem): Commit[] | null {
  if (!issue.fix || issue.fix.length === 0) return null;
  const commits = issue.fix.map((op) => commitOf(issue.slideId, op, designSystem));
  return commits.every((commit): commit is Commit => commit !== null) ? commits : null;
}
