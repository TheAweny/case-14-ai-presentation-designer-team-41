'use client';

import { useTranslations } from 'next-intl';
import { SuccessIcon } from '@/components/ui/icons';
import type { AuditIssue } from '@lct/slide-audit';
import { cn } from '@/lib/utils';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';
import { countIssues } from '@/components/editor/audit/deck-audit';
import { LEVEL_ICON, LEVEL_TEXT } from '@/components/editor/audit/audit-panel';

/**
 * Счётчик находок в подвале списка слайдов, как в строке состояния редактора кода: ошибки и
 * предупреждения колоды одним взглядом. Щелчок открывает вкладку «Проверка».
 */
export function AuditStatus({
  issues,
  onOpen,
}: {
  issues: readonly AuditIssue[];
  onOpen: () => void;
}) {
  const t = useTranslations('auditPanel');
  const { errors, warnings } = countIssues(issues);
  const clean = errors === 0 && warnings === 0;
  const label = clean ? t('statusClean') : t('status', { errors, warnings }).trim();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-audit-status=""
      onMouseDown={keepCanvasFocus}
      onClick={onOpen}
      className={cn(
        'flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground tabular-nums outline-none',
        'transition-colors duration-100 motion-reduce:transition-none',
        'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      {clean ? (
        <SuccessIcon size={14} />
      ) : (
        (['error', 'warning'] as const).map((level) => {
          const count = level === 'error' ? errors : warnings;
          if (count === 0) return null;
          const LevelIcon = LEVEL_ICON[level];
          return (
            <span key={level} className="flex items-center gap-0.5">
              <LevelIcon size={14} className={LEVEL_TEXT[level]} />
              {count}
            </span>
          );
        })
      )}
    </button>
  );
}
