'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideSchematic } from '@lct/slide-renderer';
import { cn } from '@/lib/utils';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import {
  listKeyTarget,
  nearestScroll,
  type ListOrientation,
} from '@/components/editor/slide-navigation';

/**
 * Список слайдов колоды: колонка на широком экране, горизонтальная лента на узком.
 *
 * По семантике это listbox с одиночным выбором, где выбор идёт за фокусом: стрелки, Home и End
 * сразу открывают слайд. В порядке табуляции только открытый слайд (roving tabindex), так что
 * Tab проходит список за одно нажатие.
 */
export function SlideList({
  slides,
  designSystem,
  labels,
  current,
  onSelect,
  className,
}: {
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  /** Подписи слайдов для чтения с экрана, по одной на слайд. */
  labels: readonly string[];
  current: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  const t = useTranslations('editor');
  const listRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() === true;
  const orientation: ListOrientation = useMediaQuery(NARROW_SCREEN) ? 'horizontal' : 'vertical';
  /** В какой ориентации список уже прокручивали: `null` до первого показа. */
  const scrolledRef = useRef<ListOrientation | null>(null);
  const digits = String(slides.length).length;

  /**
   * Открытый слайд всегда виден в списке, откуда бы его ни открыли: клавишами, с холста или по
   * ссылке. Фокус переезжает следом, только если он уже был в списке, — PageDown над холстом
   * фокус не отнимает. Первый показ и смена ориентации прокручивают сразу: следить глазу там
   * не за чем.
   *
   * Прокручиваем сам список, а не `scrollIntoView`: тот в Chrome переносит точку, от которой
   * считает Tab, и первый Tab на странице проскакивал бы открытый слайд.
   */
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (!list || !option) return;
    if (list.contains(document.activeElement) && document.activeElement !== option) {
      option.focus({ preventScroll: true });
    }
    const across = orientation === 'horizontal';
    const box = list.getBoundingClientRect();
    const rect = option.getBoundingClientRect();
    const style = getComputedStyle(option);
    const scroll = across ? list.scrollLeft : list.scrollTop;
    const target = nearestScroll(
      { start: scroll, size: across ? list.clientWidth : list.clientHeight },
      {
        start: across
          ? rect.left - box.left - list.clientLeft + scroll
          : rect.top - box.top - list.clientTop + scroll,
        size: across ? rect.width : rect.height,
      },
      // Поле берём из `scroll-margin` строки: оно же работает и при прокрутке браузером.
      parseFloat(across ? style.scrollMarginLeft : style.scrollMarginTop) || 0,
    );
    if (target !== scroll) {
      const animate = scrolledRef.current === orientation && !reduceMotion;
      list.scrollTo({
        [across ? 'left' : 'top']: target,
        behavior: animate ? 'smooth' : 'instant',
      });
    }
    scrolledRef.current = orientation;
  }, [current, orientation, reduceMotion]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('slides')}
      aria-orientation={orientation}
      onKeyDown={(event) => {
        const target = listKeyTarget(event.key, current, slides.length, orientation);
        if (target === null) return;
        event.preventDefault();
        onSelect(target);
      }}
      className={cn(
        'flex gap-1 overscroll-contain p-2 [scrollbar-width:thin]',
        'max-md:overflow-x-auto md:flex-col md:overflow-y-auto',
        className,
      )}
    >
      {slides.map((slide, index) => {
        const selected = index === current;
        return (
          // Номер стоит поперёк списка — слева в колонке, сверху в ленте, — чтобы миниатюры
          // шли вдоль него вплотную и не делили с номерами длину прокрутки.
          <div
            key={slide.slideId}
            role="option"
            aria-selected={selected}
            aria-label={labels[index]}
            tabIndex={selected ? 0 : -1}
            data-index={index}
            onClick={() => onSelect(index)}
            className={cn(
              'group/slide flex shrink-0 cursor-pointer scroll-m-2 rounded-lg p-1 outline-none',
              'gap-1 max-md:flex-col md:gap-1.5',
            )}
          >
            <span
              aria-hidden
              // Колонка номеров шириной в самый длинный номер колоды: миниатюры стоят ровно.
              style={{ width: `${digits}ch` }}
              className={cn(
                'shrink-0 text-[0.6875rem] leading-4 tabular-nums md:text-right',
                'text-muted-foreground transition-colors group-hover/slide:text-foreground',
                'group-aria-selected/slide:text-foreground',
              )}
            >
              {index + 1}
            </span>
            {/*
             * Размер миниатюры задаёт ось списка: в колонке — ширина, в ленте — высота. Вторую
             * сторону даёт пропорция самого слайда, какой бы она ни была у шаблона.
             */}
            <div
              style={{ aspectRatio: `${slide.slideCx} / ${slide.slideCy}` }}
              className={cn(
                'overflow-hidden rounded-md bg-card text-foreground/85 ring-1 ring-border',
                'transition-[box-shadow,color] duration-150 motion-reduce:transition-none',
                'group-hover/slide:ring-foreground/25',
                'group-aria-selected/slide:text-foreground group-aria-selected/slide:ring-2',
                'group-aria-selected/slide:ring-primary/80',
                'group-focus-visible/slide:ring-offset-2 group-focus-visible/slide:ring-offset-card',
                'max-md:h-16 md:min-w-0 md:flex-1',
              )}
            >
              <SlideSchematic
                slide={slide}
                designSystem={designSystem}
                aria-label={labels[index] ?? ''}
                aria-hidden
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
