'use client';

import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePanelRef } from 'react-resizable-panels';
import type { Deck } from '@/lib/deck-source';
import { cn } from '@/lib/utils';
import { NARROW_SCREEN } from '@/lib/use-media-query';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SlideCanvas } from '@/components/editor/slide-canvas';
import { SlideList } from '@/components/editor/slide-list';
import { arrowDirection, gridForSlide, nudgeByBaseline } from '@/components/editor/slide-geometry';
import { isTypingTarget, slideTitle } from '@/components/editor/slide-navigation';
import { ToolRailDock } from '@/components/editor/tool-rail-dock';
import { useDeckHistory, type ElementMove } from '@/components/editor/use-deck-history';
import { useSlideSelection } from '@/components/editor/use-slide-selection';
import { LocaleSwitcher } from '@/components/locale-switcher';

function Slot({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-2xl bg-card ring-1 ring-border', className)} {...props} />;
}

export function EditorShell({
  deck,
  media = {},
}: {
  deck: Deck;
  /** Адрес картинки по `mediaPart`. Нет адреса — на слайде рамка. */
  media?: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('editor');
  const resolveMedia = useCallback((mediaPart: string) => media[mediaPart] ?? null, [media]);
  const aiPanelRef = usePanelRef();
  const aiElementRef = useRef<HTMLDivElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { slides, move, undo, redo } = useDeckHistory(deck.slides);
  const { designSystem } = deck;
  const { index, select } = useSlideSelection(slides);
  const slide = slides[index];
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const slideId = slide?.slideId;

  useEffect(() => {
    setSelectedIds([]);
  }, [slideId]);

  const commit = useCallback(
    (moves: readonly ElementMove[]) => {
      if (!slideId) return;
      move(slideId, moves);
    },
    [move, slideId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isTypingTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.code === 'KeyZ' && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command || event.altKey || event.shiftKey || event.defaultPrevented) return;
      const direction = arrowDirection(event.code);
      if (!direction || selectedIds.length === 0 || !slide) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="listbox"]')) return;
      event.preventDefault();
      const grid = gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy);
      move(
        slide.slideId,
        selectedIds.flatMap((elementId) => {
          const element = slide.elements.find((item) => item.elementId === elementId);
          if (!element) return [];
          return [{ elementId, box: nudgeByBaseline(element.box, direction, grid) }];
        }),
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [designSystem.grid, move, redo, selectedIds, slide, undo]);

  /** Подпись слайда для чтения с экрана: место в колоде и, если есть, заголовок. */
  const labels = useMemo(
    () =>
      slides.map((item, i) => {
        const values = { number: i + 1, total: slides.length };
        const title = slideTitle(item);
        return title === null
          ? t('slideLabel', values)
          : t('slideLabelTitled', { ...values, title });
      }),
    [slides, t],
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_SCREEN);
    const collapseOnNarrow = () => {
      if (mq.matches) aiPanelRef.current?.collapse();
    };
    collapseOnNarrow();
    mq.addEventListener('change', collapseOnNarrow);
    return () => mq.removeEventListener('change', collapseOnNarrow);
  }, [aiPanelRef]);

  /**
   * Пока панель ассистента открыта, кнопка на рейке лишняя. Ширину читаем сами: панель
   * схлопывают и перетаскиванием ручки, и двойным кликом по ней, и с кнопки.
   */
  useEffect(() => {
    const element = aiElementRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAiOpen(element.offsetWidth > 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="h-dvh overflow-hidden bg-background">
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel id="studio" minSize="50%" className="min-w-0">
          {/*
           * Слайды прижаты к краю, инструменты плавают над холстом, с которым работают. На узком
           * экране слайды уходят в ленту снизу, и её высоту задают сами миниатюры.
           */}
          <div
            className={cn(
              'grid h-full gap-3 p-3',
              'grid-cols-1 grid-rows-[minmax(0,1fr)_auto]',
              'md:grid-cols-[11rem_minmax(0,1fr)] md:grid-rows-1',
            )}
          >
            <Slot className="flex min-h-0 min-w-0 max-md:order-2 md:flex-col">
              <SlideList
                slides={slides}
                designSystem={designSystem}
                labels={labels}
                current={index}
                onSelect={select}
                className="min-h-0 min-w-0 flex-1"
              />
              {/*
               * Настройки приложения живут в подвале колонки, пока у редактора нет своего меню.
               * Там же счётчик: он про место в этом списке и не спорит с рейкой за края холста.
               */}
              <div
                className={cn(
                  'flex shrink-0 items-center justify-between gap-1 p-1.5',
                  'max-md:flex-col max-md:justify-center max-md:border-l md:border-t',
                )}
              >
                <LocaleSwitcher />
                <p className="px-2 text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">
                    {t('slideLabel', { number: index + 1, total: slides.length })}
                  </span>
                  <span aria-hidden>
                    {t('counter', { number: index + 1, total: slides.length })}
                  </span>
                </p>
              </div>
            </Slot>
            <ToolRailDock
              className="min-h-0 min-w-0 p-2 md:p-6"
              railClassName="max-md:hidden"
              hiddenTools={aiOpen ? ['ai'] : []}
              onSelect={(id) => {
                if (id === 'ai') aiPanelRef.current?.expand();
              }}
            >
              {/*
               * Поля вокруг слайда — место, где рейка встаёт у любого из четырёх краёв, не
               * наезжая на него. На узком экране рейки нет, и полей тоже.
               */}
              {slide ? (
                <SlideCanvas
                  slide={slide}
                  designSystem={designSystem}
                  label={labels[index] ?? ''}
                  resolveMedia={resolveMedia}
                  selectedIds={selectedIds}
                  onSelect={setSelectedIds}
                  onCommit={commit}
                  className="md:p-14"
                />
              ) : null}
            </ToolRailDock>
          </div>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          onDoubleClick={() => {
            const panel = aiPanelRef.current;
            if (!panel) return;
            if (panel.isCollapsed()) panel.expand();
            else panel.collapse();
          }}
        />

        <ResizablePanel
          id="ai"
          panelRef={aiPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={320}
          minSize={260}
          maxSize="36%"
          elementRef={aiElementRef}
          className="min-w-0 bg-sidebar"
        >
          <div aria-label={t('assistant')} className="h-full" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
