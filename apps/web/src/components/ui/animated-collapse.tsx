'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/** Keeps disclosure content mounted while closing, without leaving hidden controls focusable. */
export function AnimatedCollapse({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      id={id}
      inert={!open}
      aria-hidden={!open}
      initial={false}
      animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: reduce ? 0 : open ? 0.24 : 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      {children}
    </motion.div>
  );
}
