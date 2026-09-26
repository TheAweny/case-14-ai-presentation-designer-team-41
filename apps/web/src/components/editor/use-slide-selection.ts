'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SlideIr } from '@lct/contracts';
import { SLIDE_PARAM, slideIndexFromParam } from '@/components/editor/slide-navigation';

/**
 * Открытый слайд колоды. Он живёт в адресе (`?slide=<slideId>`), а не в состоянии: ссылка
 * открывает тот же слайд, а обновление страницы его не теряет.
 *
 * Адрес меняется через `replaceState`: листание — не переход, и «Назад» должен уводить со
 * страницы, а не проходить по всем слайдам. Next подхватывает вызов сам и обновляет
 * `useSearchParams` без запроса к серверу. Поэтому хук требует границу Suspense выше.
 *
 * Клавиши листания (PageUp/PageDown, Ctrl+1…9, Home/End) слушает редактор по общему реестру
 * сочетаний, см. `editor-keymap.ts`.
 */
export function useSlideSelection(slides: readonly SlideIr[]) {
  const searchParams = useSearchParams();
  const index = slideIndexFromParam(slides, searchParams.get(SLIDE_PARAM));

  /**
   * Открыть слайд по id. Нужен сразу после вставки слайда: в `slides` нового ещё нет, а в
   * адрес он уже может попасть — индекс найдётся на следующем рендере.
   */
  const selectById = useCallback((slideId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(SLIDE_PARAM) === slideId) return;
    params.set(SLIDE_PARAM, slideId);
    window.history.replaceState(null, '', `?${params.toString()}${window.location.hash}`);
  }, []);

  const select = useCallback(
    (next: number) => {
      const slide = slides[next];
      if (slide) selectById(slide.slideId);
    },
    [selectById, slides],
  );

  return { index, select, selectById };
}
