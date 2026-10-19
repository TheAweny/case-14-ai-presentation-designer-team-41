'use client';

import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { REASONING_EFFORTS, type ReasoningEffort } from '@lct/contracts';

const EDGE = 12;
const EASE = [0.23, 1, 0.32, 1] as [number, number, number, number];

/** Depth control from the motion prototype: the value changes at once, the thumb eases over. */
export function EffortSlider({
  value,
  onChange,
  label,
  valueText,
  disabled = false,
}: {
  value: ReasoningEffort;
  onChange: (value: ReasoningEffort) => void;
  label: string;
  valueText: (value: ReasoningEffort) => string;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const seen = useRef<HTMLDivElement | null>(null);
  const index = Math.max(0, REASONING_EFFORTS.indexOf(value));

  useLayoutEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const fill = fillRef.current;
    if (!track || !thumb || !fill) return;
    let controls: AnimationPlaybackControls[] = [];
    let measured = track.clientWidth;
    const paint = (smooth: boolean) => {
      controls.forEach((control) => control.stop());
      const width = track.clientWidth;
      const progress = index / Math.max(1, REASONING_EFFORTS.length - 1);
      const offset = Math.max(0, width - EDGE * 2) * progress;
      // Track and fill run between the two extreme thumb centres, so the thumb covers their ends:
      // nothing peeks out past it at either end.
      const thumbTransform = `translateX(${offset}px)`;
      const fillTransform = `scaleX(${progress})`;
      if (!smooth || reduce) {
        thumb.style.transform = thumbTransform;
        fill.style.transform = fillTransform;
        return;
      }
      const transition = { duration: 0.22, ease: EASE };
      controls = [
        animate(thumb, { transform: thumbTransform }, transition),
        animate(fill, { transform: fillTransform }, transition),
      ];
    };
    paint(seen.current === track);
    seen.current = track;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth === measured) return;
      measured = track.clientWidth;
      paint(false);
    });
    observer.observe(track);
    return () => {
      controls.forEach((control) => control.stop());
      observer.disconnect();
    };
  }, [index, reduce]);

  const setIndex = (next: number) => {
    const level = REASONING_EFFORTS[Math.max(0, Math.min(REASONING_EFFORTS.length - 1, next))];
    if (level && level !== value) onChange(level);
  };
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setIndex(Math.round(ratio * (REASONING_EFFORTS.length - 1)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -1
          : 0;
    if (disabled) return;
    if (step) {
      event.preventDefault();
      setIndex(index + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setIndex(REASONING_EFFORTS.length - 1);
    }
  };
  const stepAt = (at: number) =>
    `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${at / Math.max(1, REASONING_EFFORTS.length - 1)})`;

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative mx-2 mt-1 mb-2 h-6 touch-none outline-none select-none',
        disabled ? 'cursor-default opacity-40' : 'cursor-pointer',
      )}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={REASONING_EFFORTS.length - 1}
      aria-valuenow={index}
      aria-valuetext={valueText(value)}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Capture is optional once the browser has released the pointer.
        }
        event.currentTarget.focus({ preventScroll: true });
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) fromPointer(event);
      }}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden className="absolute inset-x-3 top-2 bottom-2 rounded bg-muted" />
      <span
        ref={fillRef}
        aria-hidden
        className="absolute inset-x-3 top-2 bottom-2 origin-left rounded bg-foreground/40"
      />
      {REASONING_EFFORTS.map((level, at) => (
        <i
          key={level}
          aria-hidden
          className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/30"
          style={{ left: stepAt(at) }}
        />
      ))}
      <span
        ref={thumbRef}
        aria-hidden
        className="absolute top-1 left-3 -ml-2 size-4 rounded-full bg-foreground shadow-[0_2px_6px_rgba(0,0,0,0.25)]"
      />
    </div>
  );
}
