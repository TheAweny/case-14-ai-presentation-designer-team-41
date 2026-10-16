'use client';

import { motion, useReducedMotion } from 'motion/react';

// Polygon geometry adapted from React Bits PromptBar (David Haz, 2026).
// Source: https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/Micro/PromptBar/PromptBar.tsx
// License: docs/third-party/react-bits-license.txt (MIT + Commons Clause).

/** Matching polygon vertices keep the send/stop transition continuous when interrupted. */
export function SendGlyph({ stopped }: { stopped: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="size-4"
      aria-hidden
      fill="currentColor"
      initial={false}
      animate={{
        rotate: reduce ? 0 : stopped ? [0, 8, 0] : [0, -8, 0],
        scaleX: reduce ? 1 : [1, 0.88, 1],
        scaleY: reduce ? 1 : [1, 1.12, 1],
      }}
      transition={{ duration: reduce ? 0 : 0.24, ease: [0.77, 0, 0.175, 1] }}
    >
      <motion.path
        initial={false}
        animate={{
          d: stopped
            ? 'M12 6L18 6L18 12L18 18L6 18L6 12L6 6Z'
            : 'M12 4.5L18.5 11L14.25 11L14.25 19.5L9.75 19.5L9.75 11L5.5 11Z',
        }}
        transition={{ duration: reduce ? 0 : 0.24, ease: [0.77, 0, 0.175, 1] }}
      />
    </motion.svg>
  );
}
