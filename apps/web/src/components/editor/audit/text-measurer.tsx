'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideFrame, TextMark, slideSizeOf } from '@lct/slide-renderer';
import { pxToEmu } from '@/components/editor/text-fit';

/** Где стоит набранный текст блока, в EMU: высота строк и их протяжённость по горизонтали. */
export interface TextMetric {
  readonly height: number;
  /** Левый край самой левой строки от левого края слайда. */
  readonly x: number;
  /** От него до правого края самой правой строки. */
  readonly cx: number;
}

/** Замер набранного текста: слайд → блок → метрика. */
export type TextHeights = ReadonlyMap<string, ReadonlyMap<string, TextMetric>>;

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

/**
 * Где по горизонтали стоят буквы блока, в пикселях от `origin`: по прямоугольникам текстовых
 * узлов, а не абзацев — абзац занимает всю ширину рамки, даже когда строка в нём короткая.
 */
function contentExtent(mark: HTMLElement, origin: number): { x: number; cx: number } | null {
  const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
  }
  return right > left ? { x: left - origin, cx: right - left } : null;
}

function sameMetric(a: TextMetric | undefined, b: TextMetric): boolean {
  return a !== undefined && a.height === b.height && a.x === b.x && a.cx === b.cx;
}

function sameHeights(
  a: ReadonlyMap<string, TextMetric> | undefined,
  b: ReadonlyMap<string, TextMetric>,
) {
  if (!a || a.size !== b.size) return false;
  for (const [id, value] of b) if (!sameMetric(a.get(id), value)) return false;
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
  onMeasure: (slideId: string, heights: ReadonlyMap<string, TextMetric>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const size = slideSizeOf(slide);

  useLayoutEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const width = frame.offsetWidth;
    const origin = frame.getBoundingClientRect().left;
    const toEmu = (px: number) => Math.round(pxToEmu(px, width, slide.slideCx));
    const heights = new Map<string, TextMetric>();
    for (const node of frame.querySelectorAll<HTMLElement>('[data-measure-id]')) {
      const mark = node.firstElementChild;
      const id = node.dataset.measureId;
      if (!(mark instanceof HTMLElement) || !id) continue;
      const px = contentHeight(mark);
      const extent = contentExtent(mark, origin);
      if (px === null || extent === null) continue;
      heights.set(id, { height: toEmu(px), x: toEmu(extent.x), cx: toEmu(extent.cx) });
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
  const heights = useRef(new Map<string, ReadonlyMap<string, TextMetric>>());
  const report = useRef(onChange);
  useEffect(() => {
    report.current = onChange;
  }, [onChange]);

  // Ссылка стабильна, иначе каждая перерисовка снимала бы замер со всех слайдов.
  const [onMeasure] = useState(
    () => (slideId: string, measured: ReadonlyMap<string, TextMetric>) => {
      if (sameHeights(heights.current.get(slideId), measured)) return;
      heights.current = new Map(heights.current).set(slideId, measured);
      report.current(heights.current);
    },
  );

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
