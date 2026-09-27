'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { BackIcon, NextIcon } from '@/components/ui/icons';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Просмотр слайдов без редактора: крупный слайд, стрелки и лента миниатюр. Им смотрят то, что
 * агент собрал, — не открывая колоду на правку.
 *
 * Слайд, с которого открыть, читается при монтировании: каждое открытие с нового места —
 * новый `key` у диалога.
 */
export function SlidesDialog({
  open,
  onOpenChange,
  title,
  description,
  slides,
  designSystem,
  resolveMedia,
  start = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
  /** С какого слайда открыть. */
  start?: number;
}) {
  const t = useTranslations('assistant.slides');
  const [index, setIndex] = useState(start);
  const strip = useRef<HTMLOListElement>(null);
  const count = slides.length;
  const at = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const current = slides[at];

  useEffect(() => {
    strip.current
      ?.querySelectorAll('li')
      [at]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [at]);

  const go = (step: number) => setIndex((value) => Math.min(Math.max(value + step, 0), count - 1));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setIndex(count - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('close')}
        onKeyDown={onKeyDown}
        className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="px-5 pt-4 pb-3 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/40 px-12 py-5">
          {current ? (
            <div
              key={current.slideId}
              className="assistant-reveal w-full max-w-4xl overflow-hidden rounded-sm shadow-xl shadow-black/25 motion-reduce:animate-none"
            >
              <SlideView
                slide={current}
                profile={designSystem}
                resolveMedia={resolveMedia}
                label={t('slide', { number: at + 1 })}
              />
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={t('previous')}
            disabled={at === 0}
            onClick={() => go(-1)}
            className="absolute left-2 rounded-full bg-background"
          >
            <BackIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={t('next')}
            disabled={at >= count - 1}
            onClick={() => go(1)}
            className="absolute right-2 rounded-full bg-background"
          >
            <NextIcon />
          </Button>
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-3">
          <ol
            ref={strip}
            aria-label={t('list')}
            className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-0.5"
          >
            {slides.map((slide, position) => (
              <li key={slide.slideId} className="w-24 shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(position)}
                  aria-label={t('slide', { number: position + 1 })}
                  aria-current={position === at ? 'true' : undefined}
                  className={cn(
                    'block w-full overflow-hidden rounded-md ring-1 ring-border outline-none',
                    'transition-shadow duration-100 hover:ring-foreground/50 focus-visible:ring-2 focus-visible:ring-ring',
                    position === at && 'ring-2 ring-foreground hover:ring-foreground',
                  )}
                >
                  <SlideView
                    slide={slide}
                    profile={designSystem}
                    resolveMedia={resolveMedia}
                    thumbnail
                  />
                </button>
              </li>
            ))}
          </ol>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {t('counter', { number: at + 1, total: count })}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
