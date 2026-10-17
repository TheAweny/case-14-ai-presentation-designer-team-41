'use client';

import { useEffect, useRef } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';

// Polygon geometry adapted from React Bits PromptBar (David Haz, 2026).
// Source: https://github.com/DavidHDev/react-bits/blob/main/src/ts-tailwind/Micro/PromptBar/PromptBar.tsx
// License: docs/third-party/react-bits-license.txt (MIT + Commons Clause).

const POINTS = [
  [12, 19, 7, 17],
  [12, 5, 7, 7],
  [6, 11, 17, 7],
  [12, 5, 17, 17],
  [18, 11, 7, 17],
] as const;

function pathAt(progress: number) {
  return POINTS.map(([fromX, fromY, toX, toY], index) => {
    const x = fromX + (toX - fromX) * progress;
    const y = fromY + (toY - fromY) * progress;
    return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join('');
}

/** The prototype's open arrow morphs into Stop, including interrupted transitions. */
export function SendGlyph({ stopped }: { stopped: boolean }) {
  const reduce = useReducedMotion();
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  const progress = useMotionValue(stopped ? 1 : 0);
  useEffect(() => {
    const animation = animate(progress, stopped ? 1 : 0, {
      duration: reduce ? 0 : 0.24,
      ease: [0.77, 0, 0.175, 1],
    });
    return () => animation.stop();
  }, [stopped, reduce, progress]);
  useMotionValueEvent(progress, 'change', (value) => {
    path.current?.setAttribute('d', pathAt(value));
    path.current?.setAttribute('fill-opacity', String(value));
    const squash = reduce ? 0 : Math.sin(value * Math.PI);
    const scale = 1 - 0.12 * squash;
    if (svg.current) {
      svg.current.style.transform = squash
        ? `rotate(${(stopped ? 8 : -8) * squash}deg) scale(${scale}, ${1 / scale})`
        : '';
    }
  });
  return (
    <svg
      ref={svg}
      viewBox="0 0 24 24"
      className="size-5"
      aria-hidden
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path ref={path} d={pathAt(progress.get())} fillOpacity={progress.get()} />
    </svg>
  );
}
