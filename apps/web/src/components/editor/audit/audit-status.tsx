'use client';

import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
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
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={14}
          strokeWidth={1.75}
          color="currentColor"
        />
      ) : (
        (['error', 'warning'] as const).map((level) => {
          const count = level === 'error' ? errors : warnings;
          if (count === 0) return null;
          return (
            <span key={level} className="flex items-center gap-0.5">
              <HugeiconsIcon
                icon={LEVEL_ICON[level]}
                size={14}
                strokeWidth={1.75}
                color="currentColor"
                className={LEVEL_TEXT[level]}
              />
              {count}
            </span>
          );
        })
      )}
    </button>
  );
}
