'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/components/ui/icons';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { cn } from '@/lib/utils';
import { TaskGlyph } from './task-glyph';

// ThoughtLine interaction adapted from React Bits by David Haz via prototypes/motion-lab.
// License: docs/third-party/react-bits-license.txt (MIT + Commons Clause).
/** A real activity summary: expands during work, settles when the server completes it. */
export function ThoughtLine({
  state,
  label,
  children,
}: {
  state: 'running' | 'done' | 'failed' | 'cancelled';
  label: string;
  children?: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const running = state === 'running';
  const open = expanded ?? running;
  const summary = (
    <>
      <TaskGlyph state={state} />
      <span className={cn('min-w-0 break-words', running && 'assistant-shimmer')}>{label}</span>
    </>
  );
  return (
    <section className="thought-line flex min-w-0 flex-col text-[0.8125rem] text-muted-foreground">
      {children ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setExpanded(!open)}
            className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {summary}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                'ml-auto size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
                !open && '-rotate-90',
              )}
            />
          </button>
          <AnimatedCollapse open={open} id={id}>
            <div className="pb-1 pl-6">{children}</div>
          </AnimatedCollapse>
        </>
      ) : (
        <p role="status" className="flex min-h-9 items-center gap-2 px-1">
          {summary}
        </p>
      )}
    </section>
  );
}
