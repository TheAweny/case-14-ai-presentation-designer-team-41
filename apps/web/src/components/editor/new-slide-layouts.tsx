'use client';

import { memo, useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import type { SlideLayout } from '@/lib/deck-source';
import { cn } from '@/lib/utils';
import { useEmptyTextPrompt } from '@/components/editor/empty-text';
import { slideFromLayout, type DeckFrame } from '@/components/editor/slide-factory';

/** Вариант нового слайда: пустой (`layout: null`) или макет шаблона. */
export interface NewSlideChoice {
  readonly key: string;
  readonly name: string;
  readonly layout: SlideLayout | null;
  /** Как слайд будет выглядеть: заготовка макета или пустой слайд колоды. */
  readonly preview: SlideIr;
}

/**
 * Варианты нового слайда: первым — пустой, он есть всегда, даже если в шаблоне такого макета нет.
 * Дальше — макеты шаблона в порядке файла.
 */
export function useNewSlideChoices(
  layouts: readonly SlideLayout[],
  frame: DeckFrame | undefined,
): readonly NewSlideChoice[] {
  const t = useTranslations('slideList');
  const blank = t('blankSlide');
  return useMemo(() => {
    const choices: NewSlideChoice[] = layouts.map((layout) => ({
      key: layout.slide.patternId,
      name: layout.name,
      layout,
      preview: layout.slide,
    }));
    if (!frame) return choices;
    const preview = slideFromLayout(null, frame, 'new-slide-blank');
    return [{ key: preview.patternId, name: blank, layout: null, preview }, ...choices];
  }, [blank, frame, layouts]);
}

/**
 * Плитки вариантов: миниатюра и имя макета. Пункт меню — снаружи (`item`): одни и те же плитки
 * стоят и в меню кнопки «Новый слайд», и в подменю списка слайдов.
 */
export function NewSlideTiles({
  choices,
  designSystem,
  resolveMedia,
  item,
}: {
  choices: readonly NewSlideChoice[];
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
  item: (choice: NewSlideChoice, tile: ReactNode) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-2 gap-1" data-new-slide-layouts="">
      {choices.map((choice) =>
        item(
          choice,
          <LayoutTile
            slide={choice.preview}
            name={choice.name}
            designSystem={designSystem}
            resolveMedia={resolveMedia}
          />,
        ),
      )}
    </div>
  );
}

/** Классы пункта меню с плиткой: миниатюра над подписью, на всю ширину колонки. */
export const TILE_ITEM_CLASS = 'group/tile min-w-0 flex-col items-stretch gap-1 p-1.5';

const LayoutTile = memo(function LayoutTile({
  slide,
  name,
  designSystem,
  resolveMedia,
}: {
  slide: SlideIr;
  name: string;
  designSystem: DesignSystem;
  resolveMedia?: (mediaPart: string) => string | null;
}) {
  const emptyText = useEmptyTextPrompt();
  return (
    <>
      <div
        data-layout-thumb=""
        style={{ aspectRatio: `${slide.slideCx} / ${slide.slideCy}` }}
        className={cn(
          'overflow-hidden rounded-md bg-card ring-1 ring-border',
          // Рамка отзывается на фокус пункта: с клавиатуры видно, какой макет выбран.
          'group-focus/tile:ring-2 group-focus/tile:ring-primary',
        )}
      >
        <SlideView
          slide={slide}
          profile={designSystem}
          resolveMedia={resolveMedia}
          emptyText={emptyText}
          thumbnail
        />
      </div>
      <span className="truncate text-center">{name}</span>
    </>
  );
});
