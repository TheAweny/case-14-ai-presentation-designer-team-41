'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideFrame, TextMark, slideSizeOf } from '@lct/slide-renderer';
import { pxToEmu } from '@/components/editor/text-fit';

/** Высота набранного текста: слайд → блок → EMU. */
export type TextHeights = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Ширина кадра замера. Текст меряется в долях слайда, так что подойдёт любая, но на крупном
 * кадре округление строк до пикселя почти не влияет на результат.
 */
const MEASURE_WIDTH_PX = 1280;

/**
 * Счётчик загрузок шрифтов: растёт, когда браузер догрузил очередной. Шрифт, который пришёл
 * позже первого замера, переносит строки иначе, и высоты надо снять заново.
 */
function useFontLoads(): number {
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    if (!fonts) return;
    let alive = true;
    const bump = () => {
      if (alive) setLoads((count) => count + 1);
    };
    void fonts.ready.then(bump);
    fonts.addEventListener('loadingdone', bump);
    return () => {
      alive = false;
      fonts.removeEventListener('loadingdone', bump);
    };
  }, []);
  return loads;
}

/** Высота строк блока в пикселях: от верха первого абзаца до низа последнего. */
function contentHeight(mark: HTMLElement): number | null {
  const lines = [...mark.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const first = lines[0];
  const last = lines.at(-1);
  if (!first || !last) return null;
  return last.offsetTop + last.offsetHeight - first.offsetTop;
}

function sameHeights(a: ReadonlyMap<string, number> | undefined, b: ReadonlyMap<string, number>) {
  if (!a || a.size !== b.size) return false;
  for (const [id, value] of b) if (a.get(id) !== value) return false;
  return true;
}

const MeasuredSlide = memo(function MeasuredSlide({
  slide,
  designSystem,
  fontLoads,
  onMeasure,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  fontLoads: number;
  onMeasure: (slideId: string, heights: ReadonlyMap<string, number>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = slideSizeOf(slide);

  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const width = frame.offsetWidth;
    const heights = new Map<string, number>();
    for (const node of frame.querySelectorAll<HTMLElement>('[data-measure-id]')) {
      const mark = node.firstElementChild;
      const id = node.dataset.measureId;
      if (!(mark instanceof HTMLElement) || !id) continue;
      const px = contentHeight(mark);
      if (px !== null) heights.set(id, Math.round(pxToEmu(px, width, slide.slideCx)));
    }
    onMeasure(slide.slideId, heights);
  }, [slide, designSystem, fontLoads, onMeasure]);

  return (
    <div ref={ref}>
      <SlideFrame size={size}>
        {slide.elements.map((element) =>
          element.kind === 'text' ? (
            // Обёртка без позиции: метка встаёт по рамке кадра, как на холсте.
            <div key={element.elementId} data-measure-id={element.elementId}>
              <TextMark element={element} size={size} profile={designSystem} thumbnail />
            </div>
          ) : null,
        )}
      </SlideFrame>
    </div>
  );
});

/**
 * Снимает высоту набранного текста во всех текстовых блоках колоды — теми шрифтами, что
 * загружены в браузере. Для этого текст каждого слайда рисуется вне экрана тем же `TextMark`,
 * что и на холсте, но без меток `data-element-id`: поиск объектов по странице сюда не попадёт.
 *
 * Перерисовывается только изменённый слайд: правка создаёт новый объект слайда, прочие те же.
 */
export function TextMeasurer({
  slides,
  designSystem,
  onChange,
}: {
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  onChange: (heights: TextHeights) => void;
}) {
  const fontLoads = useFontLoads();
  const heights = useRef(new Map<string, ReadonlyMap<string, number>>());
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  }, [onChange]);

  // Ссылка стабильна, иначе каждая перерисовка снимала бы замер со всех слайдов.
  const [onMeasure] = useState(() => (slideId: string, measured: ReadonlyMap<string, number>) => {
    if (sameHeights(heights.current.get(slideId), measured)) return;
    heights.current = new Map(heights.current).set(slideId, measured);
    report.current(heights.current);
  });

  return (
    <div
      aria-hidden
      inert
      style={{
        position: 'fixed',
        top: 0,
        left: -2 * MEASURE_WIDTH_PX,
        width: MEASURE_WIDTH_PX,
        visibility: 'hidden',
        pointerEvents: 'none',
        contain: 'layout paint',
      }}
    >
      {slides.map((slide) => (
        <MeasuredSlide
          key={slide.slideId}
          slide={slide}
          designSystem={designSystem}
          fontLoads={fontLoads}
          onMeasure={onMeasure}
        />
      ))}
    </div>
  );
}
