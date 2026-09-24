'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { cn } from '@/lib/utils';
import { showAction, showStep, slideAfterShow } from '@/components/editor/show-navigation';

/** Через столько мс без движения мыши курсор и кнопки показа прячутся. */
const IDLE_AFTER = 2000;

/**
 * Показ слайдов на весь экран: чёрное поле, слайд вписан целиком и обрезан по кадру, как в
 * PowerPoint и Google Slides. Клавиши — `show-navigation.ts`; щелчок — вперёд; Esc или выход
 * из полноэкранного режима закрывают показ, и редактор открывает слайд, на котором
 * остановились.
 *
 * Если браузер не дал полный экран (нет жеста, запрет в iframe), показ всё равно идёт —
 * поверх окна.
 */
export function SlideShow({
  slides,
  designSystem,
  labels,
  start,
  resolveMedia,
  onExit,
}: {
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  /** Подписи слайдов для чтения с экрана. */
  labels: readonly string[];
  start: number;
  resolveMedia?: (mediaPart: string) => string | null;
  /** Показ закрыт; `index` — слайд, на котором остановились. */
  onExit: (index: number) => void;
}) {
  const t = useTranslations('slideShow');
  const rootRef = useRef<HTMLDivElement>(null);
  const count = slides.length;
  const [position, setPosition] = useState(() => slideAfterShow(start, count));
  const [idle, setIdle] = useState(false);
  const latest = useRef({ position, count, onExit });
  useEffect(() => {
    latest.current = { position, count, onExit };
  });

  const exit = useCallback(() => {
    const { position: at, count: total, onExit: close } = latest.current;
    close(slideAfterShow(at, total));
  }, []);

  const go = useCallback(
    (action: 'next' | 'previous' | 'first' | 'last' | 'exit') => {
      const { position: at, count: total } = latest.current;
      const next = showStep(at, action, total);
      if (next === 'exit') exit();
      else setPosition(next);
    },
    [exit],
  );

  // Полный экран и фокус: клавиши показа — у показа, а не у холста под ним. Выход из полного
  // экрана (Esc у браузера, жест системы) закрывает показ.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === root) {
        entered = true;
        return;
      }
      if (entered) exit();
    };
    document.addEventListener('fullscreenchange', onChange);
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
      root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    }
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement === root)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, [exit]);

  // Курсор и кнопки уходят, пока мышь стоит: слайду ничто не мешает.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setIdle(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_AFTER);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [wake]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Tab остаётся у кнопок показа, Enter и пробел на кнопке нажимают её.
    const onButton = event.target instanceof Element && event.target.closest('button');
    if (onButton && (event.code === 'Enter' || event.code === 'Space')) return;
    const action = showAction(event);
    // Остальные клавиши показ тоже не отдаёт: под ним редактор, и Delete удалил бы объект.
    event.stopPropagation();
    if (!action) return;
    event.preventDefault();
    if (action !== 'ignore') go(action);
  };

  const ended = position >= count;
  const slide = ended ? undefined : slides[position];

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('label')}
      tabIndex={-1}
      data-slide-show=""
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerDown={wake}
      onClick={(event) => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        go('next');
      }}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        'fixed inset-0 z-[6000] bg-black text-white outline-none select-none',
        idle && 'cursor-none',
      )}
    >
      <div className="grid size-full place-items-center [container-type:size]">
        {slide ? (
          <div
            role="img"
            aria-label={labels[position] ?? ''}
            style={{ width: `min(100cqw, 100cqh * ${slide.slideCx} / ${slide.slideCy})` }}
          >
            {/*
             * Режим миниатюры — ровно то, что нужно показу: слайд обрезан по кадру, без меток
             * переполнения и без крючков редактора, по которым холст ищет объекты.
             */}
            <SlideView slide={slide} profile={designSystem} resolveMedia={resolveMedia} thumbnail />
          </div>
        ) : (
          <p className="px-6 text-center text-sm text-white/60">{t('end')}</p>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {ended ? t('end') : t('counter', { number: position + 1, total: count })}
      </p>

      <div
        className={cn(
          // Своя тёмная подложка: кнопки читаются и поверх светлого слайда.
          'absolute right-4 bottom-4 flex items-center gap-1 rounded-full bg-black/70 p-1',
          'ring-1 ring-white/15 backdrop-blur transition-opacity duration-200',
          'motion-reduce:transition-none',
          idle ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
      >
        <ShowButton label={t('previous')} icon={ArrowLeft01Icon} onClick={() => go('previous')} />
        <span aria-hidden className="min-w-12 px-1 text-center text-xs tabular-nums text-white/80">
          {t('counter', { number: Math.min(position + 1, count), total: count })}
        </span>
        <ShowButton label={t('next')} icon={ArrowRight01Icon} onClick={() => go('next')} />
        <ShowButton label={t('exit')} icon={Cancel01Icon} onClick={exit} />
      </div>
    </div>,
    document.body,
  );
}

function ShowButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconSvgElement;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-9 place-items-center rounded-full text-white/80 outline-none',
        'hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60',
        'pointer-coarse:size-11',
      )}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={2} color="currentColor" />
    </button>
  );
}
