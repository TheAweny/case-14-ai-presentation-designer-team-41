'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { SlideHandles } from '@/components/editor/slide-handles';
import { gridForSlide } from '@/components/editor/slide-geometry';
import type { ElementMove } from '@/components/editor/use-deck-history';
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
  selectedIds,
  onSelect,
  onCommit,
  className,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  /** Что на слайде, для чтения с экрана. */
  label: string;
  /** Адрес картинки по `mediaPart`. Нет адреса — рамка. */
  resolveMedia?: (mediaPart: string) => string | null;
  selectedIds: readonly string[];
  onSelect: (ids: readonly string[]) => void;
  /** Конец жеста: один список новых рамок, не шаг на каждый пиксель. */
  onCommit: (moves: readonly ElementMove[]) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() === true;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const rememberHost = useCallback((node: HTMLDivElement | null) => setHost(node), []);
  const aligned = gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy);

  return (
    <div className={cn('grid size-full place-items-center [container-type:size]', className)}>
      {/*
       * Лист неподвижен, меняется только то, что на нём: при смене слайда разметка тает и
       * проявляется заново, а подложка и рамка остаются на месте. Ручки живут рядом с листом,
       * а не внутри него: у листа overflow скрывает всё, что вышло за край.
       */}
      <div
        ref={rememberHost}
        style={{ width: `min(100cqw, 100cqh * ${slide.slideCx} / ${slide.slideCy})` }}
        className="relative"
      >
        {/*
         * Кадр не размонтируется вместе со слайдом. Иначе при смене слайда React сначала
         * ставит ref на новый лист, а потом вызывает его с null для уходящего — и ручки
         * остаются привязаны к уже снятому узлу.
         */}
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
              className="rounded-xl bg-card text-foreground shadow-sm ring-1 ring-border"
            />
          </motion.div>
        </AnimatePresence>
        {host ? (
          <SlideHandles
            host={host}
            slide={slide}
            grid={aligned}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onCommit={onCommit}
          />
        ) : null}
      </div>
    </div>
  );
}
