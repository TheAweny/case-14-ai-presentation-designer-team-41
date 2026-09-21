'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { cn } from '@/lib/utils';

const FADE = { duration: 0.16, ease: 'easeOut' } as const;
const INSTANT = { duration: 0 } as const;

/**
 * Холст: открытый слайд, вписанный в доступную область целиком, без искажений.
 *
 * Область — контейнер размеров, и ширина слайда — меньшая из двух: вся ширина области или её
 * высота, умноженная на пропорцию слайда. Пропорция берётся из самого слайда, поэтому
 * одинаково вписываются и 16:9, и 4:3, и портретный шаблон, при любом размере окна.
 */
export function SlideCanvas({
  slide,
  designSystem,
  label,
  resolveMedia,
  className,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  /** Что на слайде, для чтения с экрана. */
  label: string;
  /** Адрес картинки по `mediaPart`. Нет адреса — рамка. */
  resolveMedia?: (mediaPart: string) => string | null;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() === true;

  return (
    <div className={cn('grid size-full place-items-center [container-type:size]', className)}>
      {/*
       * Лист неподвижен, меняется только то, что на нём: при смене слайда разметка тает и
       * проявляется заново, а подложка и рамка остаются на месте.
       */}
      <div
        style={{ width: `min(100cqw, 100cqh * ${slide.slideCx} / ${slide.slideCy})` }}
        className="relative overflow-hidden rounded-xl bg-card text-foreground shadow-sm ring-1 ring-border"
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={slide.slideId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? INSTANT : FADE}
          >
            <SlideView
              slide={slide}
              profile={designSystem}
              label={label}
              resolveMedia={resolveMedia}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
