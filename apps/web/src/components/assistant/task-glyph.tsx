'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import styles from './task-glyph.module.css';

// Adapted from React Bits LatticeLoader by David Haz, via prototypes/motion-lab.
// License: docs/third-party/react-bits-license.txt (MIT + Commons Clause).
// 4x4 orbit. The centre four cells are empty while it runs; done and failed
// light the prototype check and cross, which do not fit on a 3x3.
const ORBIT = [0, 1, 2, 3, 11, null, null, 4, 10, null, null, 5, 9, 8, 7, 6];
const CHECK = [7, 8, 10, 13];
const CROSS = [0, 3, 5, 6, 9, 10, 12, 15];
const REST = [5, 6, 9, 10];
const STEP = 108;
const LOOP = 648;

type TaskGlyphState = 'running' | 'done' | 'failed' | 'pending' | 'cancelled' | 'partial';

function settledLit(state: TaskGlyphState, index: number) {
  if (state === 'done') return CHECK.includes(index);
  if (state === 'failed') return CROSS.includes(index);
  if (state === 'pending' || state === 'cancelled') return REST.includes(index);
  return false;
}

/** The prototype lattice follows actual model, tool and pipeline states. */
export function TaskGlyph({ state, className }: { state: TaskGlyphState; className?: string }) {
  return (
    <span
      aria-hidden
      data-task-state={state}
      className={cn(
        'task-lattice relative grid size-5 shrink-0 place-items-center',
        styles.lattice,
        className,
      )}
    >
      <span className="task-glyph-stage grid">
        <span className="task-glyph-layer grid grid-cols-4 gap-px" data-glyph-layer="running">
          {ORBIT.map((unit, index) => (
            <span
              key={index}
              className="task-lattice-cell size-1 rounded-[1px] bg-current"
              data-hole={unit === null ? '' : undefined}
              style={{ '--cell-delay': String((unit ?? 0) * STEP - LOOP) + 'ms' } as CSSProperties}
            />
          ))}
        </span>
        <span className="task-glyph-layer grid grid-cols-4 gap-px" data-glyph-layer="settled">
          {ORBIT.map((unit, index) => (
            <span
              key={index}
              className="task-lattice-cell size-1 rounded-[1px] bg-current"
              data-lit={settledLit(state, index) ? '' : undefined}
              data-hole={unit === null ? '' : undefined}
            />
          ))}
        </span>
      </span>
      <svg viewBox="0 0 20 20" className={cn('absolute size-5 overflow-visible', styles.mark)}>
        <circle className={styles.ring} cx="10" cy="10" r="7.25" pathLength="1" />
        <path className={styles.check} d="M6.2 10.3 8.7 12.8 13.9 7.4" pathLength="1" />
      </svg>
    </span>
  );
}
