'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckIcon, WarningIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/** One visual language for model thinking, tool calls and pipeline stages. */
export function TaskGlyph({
  state,
  className,
}: {
  state: 'running' | 'done' | 'failed' | 'pending' | 'cancelled';
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      aria-hidden
      data-task-state={state}
      className={cn('relative grid size-5 shrink-0 place-items-center', className)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: reduce ? 1 : 0.7, filter: reduce ? 'none' : 'blur(2px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.7 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
          className="absolute inset-0 grid place-items-center"
        >
          {state === 'running' ? (
            <span className="task-orbit size-4 rounded-full border-[1.5px] border-current/15 border-t-current border-r-current/60" />
          ) : state === 'done' ? (
            <CheckIcon className="size-3.5" />
          ) : state === 'failed' ? (
            <WarningIcon className="size-3.5" />
          ) : (
            <span className="size-1 rounded-full bg-current opacity-50" />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
