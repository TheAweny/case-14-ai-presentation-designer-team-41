'use client';

import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
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
  state: 'running' | 'done' | 'failed' | 'cancelled' | 'partial';
  label: string;
  children?: ReactNode;
}) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const running = state === 'running';
  const [startedRunning] = useState(running);
  const open = expanded ?? (running || startedRunning);
  const summary = (
    <>
      <TaskGlyph state={state} />
      <span className="relative grid min-w-0">
        <AnimatePresence initial={false} mode="sync">
          <ThoughtLabel
            key={state + '\0' + label}
            label={label}
            running={running}
            reduce={reduceMotion}
          />
        </AnimatePresence>
      </span>
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

function ThoughtLabel({
  label,
  running,
  reduce,
}: {
  label: string;
  running: boolean;
  reduce: boolean | null;
}) {
  const present = useIsPresent();
  return (
    <motion.span
      aria-hidden={!present || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'col-start-1 row-start-1 min-w-0 break-words',
        !present && 'pointer-events-none',
        running && present && 'assistant-shimmer',
      )}
      style={!present ? ({ position: 'absolute', inset: 0 } satisfies CSSProperties) : undefined}
    >
      {label}
    </motion.span>
  );
}
