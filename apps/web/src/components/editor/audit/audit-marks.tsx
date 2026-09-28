'use client';

import type { AuditIssue } from '@lct/slide-audit';
import { cn } from '@/lib/utils';

/** Отступ рамки от места проблемы, в EMU: рамка не должна сливаться с краем объекта. */
const OUTSET_EMU = 38_100;

/**
 * Места находок на открытом слайде: пунктирная рамка цвета уровня, как волнистая черта под
 * ошибкой в редакторе кода. Рисуется в координатах слайда и масштабируется с холстом, а линия
 * остаётся тонкой при любом зуме. Сквозь неё щёлкают: это подсказка, а не объект.
 */
export function AuditMarks({
  issues,
  slideCx,
  slideCy,
  activeIssueId,
}: {
  issues: readonly AuditIssue[];
  slideCx: number;
  slideCy: number;
  activeIssueId: string | null;
}) {
  const placed = issues.filter((issue) => issue.box !== null);
  if (placed.length === 0) return null;
  return (
    <svg
      aria-hidden
      data-audit-marks=""
      viewBox={`0 0 ${slideCx} ${slideCy}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-[3] size-full overflow-visible"
    >
      {placed.map((issue) => {
        const box = issue.box;
        if (!box) return null;
        const active = issue.issueId === activeIssueId;
        return (
          <rect
            key={issue.issueId}
            data-level={issue.level}
            x={box.x - OUTSET_EMU}
            y={box.y - OUTSET_EMU}
            width={box.cx + 2 * OUTSET_EMU}
            height={box.cy + 2 * OUTSET_EMU}
            rx={OUTSET_EMU}
            vectorEffect="non-scaling-stroke"
            strokeWidth={active ? 2 : 1.25}
            strokeDasharray={active ? undefined : '4 3'}
            className={cn(
              issue.level === 'error'
                ? 'fill-destructive/5 stroke-destructive'
                : 'fill-(--project-yellow)/5 stroke-(--project-yellow)',
              active &&
                (issue.level === 'error' ? 'fill-destructive/15' : 'fill-(--project-yellow)/15'),
            )}
          />
        );
      })}
    </svg>
  );
}
