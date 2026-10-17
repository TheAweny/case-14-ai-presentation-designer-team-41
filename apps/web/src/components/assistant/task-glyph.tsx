'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// Adapted from React Bits LatticeLoader by David Haz, via prototypes/motion-lab.
// License: docs/third-party/react-bits-license.txt (MIT + Commons Clause).
// 4×4 orbit. The centre four cells are empty while it runs; done and failed
// light the prototype's check and cross, which do not fit on a 3×3.
const ORBIT = [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6];
const CHECK = [7, 8, 10, 13];
const CROSS = [0, 3, 5, 6, 9, 10, 12, 15];
const REST = [5, 6, 9, 10];
const STEP = 108;
const LOOP = 648;

/** The prototype's lattice follows actual model, tool and pipeline states. */
export function TaskGlyph({
  state,
  className,
}: {
  state: 'running' | 'done' | 'failed' | 'pending' | 'cancelled';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-task-state={state}
      className={cn('task-lattice relative grid size-5 shrink-0 place-items-center', className)}
    >
      <span className="grid grid-cols-4 gap-px">
        {ORBIT.map((unit, index) => {
          const lit =
            state === 'done'
              ? CHECK.includes(index)
              : state === 'failed'
                ? CROSS.includes(index)
                : state === 'pending' || state === 'cancelled'
                  ? REST.includes(index)
                  : false;
          return (
            <span
              key={index}
              className="task-lattice-cell size-1 rounded-[1px] bg-current"
              data-lit={lit ? '' : undefined}
              data-hole={unit === null ? '' : undefined}
              style={{ '--cell-delay': `${(unit ?? 0) * STEP - LOOP}ms` } as CSSProperties}
            />
          );
        })}
      </span>
    </span>
  );
}
