import type { Box, Grid } from '@lct/contracts';

/**
 * Сетка демо-колоды. Все рамки слайдов строятся от неё, поэтому заголовки контентных слайдов
 * стоят в одном месте, поля совпадают и ничего не выходит за слайд.
 *
 * Думаем в пунктах, храним в EMU, как OOXML. Стандартный слайд 16:9 — это 960 × 540 пт.
 */

export const EMU_PER_PT = 12_700;

export function pt(value: number): number {
  return Math.round(value * EMU_PER_PT);
}

const SLIDE_W = 960;
const SLIDE_H = 540;
const MARGIN_X = 48;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;
const COLUMNS = 12;
const GUTTER = 24;
/** 4 пт, а не 8: высота слайда 540 пт на 8 не делится, и нижнее поле не легло бы на шаг. */
const BASELINE = 4;

export const SLIDE_CX = pt(SLIDE_W);
export const SLIDE_CY = pt(SLIDE_H);

export const DEMO_GRID = {
  slideCx: SLIDE_CX,
  slideCy: SLIDE_CY,
  marginLeft: pt(MARGIN_X),
  marginRight: pt(MARGIN_X),
  marginTop: pt(MARGIN_TOP),
  marginBottom: pt(MARGIN_BOTTOM),
  columns: COLUMNS,
  gutter: pt(GUTTER),
  baseline: pt(BASELINE),
} satisfies Grid;

/** Ширина области контента и одной колонки: 864 и 50 пт. */
const CONTENT_W = SLIDE_W - MARGIN_X * 2;
const COLUMN_W = (CONTENT_W - GUTTER * (COLUMNS - 1)) / COLUMNS;

type Span = { x: number; cx: number };
type Band = { y: number; cy: number };

/** `span` колонок, начиная с колонки `start` (счёт с нуля). */
export function columns(start: number, span: number): Span {
  if (start < 0 || span < 1 || start + span > COLUMNS) {
    throw new RangeError(`columns(${start}, ${span}) is outside a ${COLUMNS}-column grid`);
  }
  return {
    x: pt(MARGIN_X + start * (COLUMN_W + GUTTER)),
    cx: pt(span * COLUMN_W + (span - 1) * GUTTER),
  };
}

/**
 * Ячейка `index` из `count` равных на всю ширину контента, с тем же интервалом, — для рядов,
 * которые не делят 12 колонок.
 */
export function cell(index: number, count: number): Span {
  if (index < 0 || index >= count) {
    throw new RangeError(`cell(${index}, ${count}) is outside the row`);
  }
  const cx = Math.floor((pt(CONTENT_W) - pt(GUTTER) * (count - 1)) / count);
  return { x: pt(MARGIN_X) + index * (cx + pt(GUTTER)), cx };
}

/** Полоса по вертикали: верх и высота в пунктах от верхнего края слайда. */
export function rows(top: number, height: number): Band {
  return { y: pt(top), cy: pt(height) };
}

export function box(span: Span, band: Band): Box {
  return { x: span.x, y: band.y, cx: span.cx, cy: band.cy };
}

/** Рамка, сжатая внутрь на `by` пунктов со всех сторон, — текст внутри карточки. */
export function inset(outer: Box, by: number): Box {
  return {
    x: outer.x + pt(by),
    y: outer.y + pt(by),
    cx: outer.cx - pt(by * 2),
    cy: outer.cy - pt(by * 2),
  };
}

/** Во всю ширину слайда, за полями: фоновые плашки шаблона. */
export const FULL_WIDTH: Span = { x: 0, cx: SLIDE_CX };
export const FULL_HEIGHT: Band = { y: 0, cy: SLIDE_CY };

/**
 * Вертикальные полосы контентного слайда. Заголовок рассчитан на две строки, под ним
 * акцентная линейка, ниже — область контента до колонтитула, колонтитул упирается в нижнее поле.
 */
export const BAND = {
  title: rows(MARGIN_TOP, 72),
  titleRule: rows(120, 4),
  body: rows(144, 320),
  footer: rows(SLIDE_H - MARGIN_BOTTOM - 16, 16),
} as const;

/** Рамка заголовка на всех контентных слайдах. */
export const CONTENT_TITLE_BOX = box(columns(0, COLUMNS), BAND.title);
