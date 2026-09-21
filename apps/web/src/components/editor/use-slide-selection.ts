'use client';

import { useCallback, useEffect, useEffectEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SlideIr } from '@lct/contracts';
import {
  SLIDE_PARAM,
  isTypingTarget,
  pageKeyStep,
  slideIndexFromParam,
  stepSlide,
} from '@/components/editor/slide-navigation';

/**
 * Открытый слайд колоды. Он живёт в адресе (`?slide=<slideId>`), а не в состоянии: ссылка
 * открывает тот же слайд, а обновление страницы его не теряет.
 *
 * Адрес меняется через `replaceState`: листание — не переход, и «Назад» должен уводить со
 * страницы, а не проходить по всем слайдам. Next подхватывает вызов сам и обновляет
 * `useSearchParams` без запроса к серверу. Поэтому хук требует границу Suspense выше.
 *
 * PageUp/PageDown листают колоду из любого места редактора, кроме полей ввода.
 */
export function useSlideSelection(slides: readonly SlideIr[]) {
  const searchParams = useSearchParams();
  const index = slideIndexFromParam(slides, searchParams.get(SLIDE_PARAM));

  const select = useCallback(
    (next: number) => {
      const slide = slides[next];
      if (!slide) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get(SLIDE_PARAM) === slide.slideId) return;
      params.set(SLIDE_PARAM, slide.slideId);
      window.history.replaceState(null, '', `?${params.toString()}${window.location.hash}`);
    },
    [slides],
  );

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Клавишу уже забрал кто-то ближе к фокусу: меню, список, поле.
    if (event.defaultPrevented || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const step = pageKeyStep(event.key);
    if (step === null || isTypingTarget(event.target)) return;
    event.preventDefault();
    select(stepSlide(index, step, slides.length));
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return { index, select };
}
