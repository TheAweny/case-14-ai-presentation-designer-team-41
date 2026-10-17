'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type StatusMarkStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

/**
 * Знак этапа из React Bits Status Mark: кольцо, дуга, галочка или крест.
 * Один размер у всех строк хода. Лицензия: docs/third-party/react-bits-license.txt.
 */
export function StatusMark({
  status,
  className,
}: {
  status: StatusMarkStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-task-state={status}
      data-status={status}
      className={cn('status-mark inline-flex size-4 shrink-0', className)}
    >
      <svg viewBox="0 0 24 24" className="size-4 overflow-visible">
        <circle className="status-mark-track" cx="12" cy="12" r="8" />
        <circle className="status-mark-arc" cx="12" cy="12" r="8" pathLength="1" />
        <path className="status-mark-check" d="M7.5 12.25 10.5 15.25 16.75 8.75" pathLength="1" />
        <path
          className="status-mark-cross"
          d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
          pathLength="1"
        />
      </svg>
    </span>
  );
}

/** Строка идущего вызова: заливка проходит по тексту и не поднимает отдельную плашку. */
export function CallChip({
  active,
  failed = false,
  children,
}: {
  active: boolean;
  failed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      data-call={active ? 'running' : failed ? 'failed' : 'idle'}
      className="call-chip relative inline-flex min-w-0 items-center"
      style={
        { '--call-wash': failed ? 'var(--destructive)' : 'var(--foreground)' } as CSSProperties
      }
    >
      <span className="relative min-w-0">{children}</span>
    </span>
  );
}
