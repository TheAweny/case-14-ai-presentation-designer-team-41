import type { Box, ElementRole, SlideElement, SlideIr } from '@lct/contracts';
import type { SlideLayout } from '../../lib/deck-source';
import { decor, image, para, text, type TextElement } from './elements';
import {
  BAND,
  CONTENT_TITLE_BOX,
  FULL_HEIGHT,
  SLIDE_CX,
  SLIDE_CY,
  box,
  columns,
  inset,
  rows,
} from './grid';
import { FOOTER, LOGO_PART, SHAPE, VARIANT } from './slides';

/**
 * Макеты демо-шаблона — то, что движок отдал бы из макетов загруженного .pptx: оформление макета
 * и пустые рамки на местах плейсхолдеров. Рамки те же, что у слайдов демо-колоды на этих макетах.
 */

/** Пустая рамка плейсхолдера: роль и место есть, текста нет. */
function slot(elementId: string, role: ElementRole, at: Box, sourceShapeId: number): TextElement {
  return text(elementId, role, at, [{ level: 0, runs: [], lineSpacing: null }], sourceShapeId);
}

function layout(
  name: string,
  patternId: string,
  build: (id: (slot: string) => string) => SlideElement[],
): SlideLayout {
  const slideId = `layout-${patternId}`;
  const slide: SlideIr = {
    schemaVersion: 1,
    slideId,
    variant: VARIANT,
    index: 0,
    patternId,
    slideCx: SLIDE_CX,
    slideCy: SLIDE_CY,
    elements: build((part) => `${slideId}-${part}`),
  };
  return { name, slide };
}

/** Заголовок контентного макета и линейка под ним. */
function header(id: (slot: string) => string): SlideElement[] {
  return [
    slot(id('title'), 'title', CONTENT_TITLE_BOX, SHAPE.title),
    decor(id('title-rule'), box(columns(0, 2), BAND.titleRule), SHAPE.titleRule),
  ];
}

/** Колонтитул шаблона. Номер страницы вёрстка ставит по месту слайда, в макете его нет. */
function footer(id: (slot: string) => string, span = columns(0, 8)): SlideElement {
  return text(
    id('footer'),
    'footer',
    box(span, BAND.footer),
    [para('footer', FOOTER)],
    SHAPE.footer,
  );
}

const titleSlide = layout('Титульный слайд', 'title-slide', (id) => [
  decor(
    id('panel'),
    box({ x: columns(8, 4).x, cx: SLIDE_CX - columns(8, 4).x }, FULL_HEIGHT),
    SHAPE.panel,
    { locked: true },
  ),
  image(id('logo'), 'logo', box(columns(0, 2), rows(40, 40)), LOGO_PART, 'contain', SHAPE.logo),
  decor(id('title-rule'), box(columns(0, 2), rows(160, 4)), SHAPE.titleRule),
  slot(id('title'), 'title', box(columns(0, 7), rows(176, 104)), SHAPE.title),
  slot(id('subtitle'), 'subtitle', box(columns(0, 7), rows(296, 56)), SHAPE.subtitle),
  footer(id, columns(0, 7)),
]);

const titleAndContent = layout('Заголовок и текст', 'title-and-content', (id) => [
  ...header(id),
  slot(id('body'), 'bullet-list', box(columns(0, 8), BAND.body), SHAPE.body),
  footer(id),
]);

const twoContent = layout('Два столбца', 'two-content', (id) => [
  ...header(id),
  slot(id('left-heading'), 'subtitle', box(columns(0, 6), rows(144, 32)), SHAPE.heading),
  slot(id('left-body'), 'bullet-list', box(columns(0, 6), rows(192, 272)), SHAPE.body),
  slot(id('right-heading'), 'subtitle', box(columns(6, 6), rows(144, 32)), SHAPE.headingRight),
  slot(id('right-body'), 'bullet-list', box(columns(6, 6), rows(192, 272)), SHAPE.bodyRight),
  footer(id),
]);

const comparison = layout('Сравнение', 'comparison', (id) => [
  ...header(id),
  ...(['left', 'right'] as const).flatMap((side, i) => {
    const card = box(columns(i * 6, 6), BAND.body);
    const inner = inset(card, 24);
    const span = { x: inner.x, cx: inner.cx };
    const shapes =
      side === 'left'
        ? { heading: SHAPE.heading, body: SHAPE.body }
        : { heading: SHAPE.headingRight, body: SHAPE.bodyRight };
    return [
      decor(id(`${side}-card`), card, SHAPE.card + i),
      slot(id(`${side}-heading`), 'subtitle', box(span, rows(168, 32)), shapes.heading),
      slot(id(`${side}-body`), 'bullet-list', box(span, rows(216, 224)), shapes.body),
    ];
  }),
  footer(id),
]);

const quote = layout('Цитата', 'quote', (id) => [
  decor(id('quote-mark'), box(columns(1, 1), rows(176, 48)), SHAPE.quoteMark),
  slot(id('quote'), 'quote', box(columns(2, 9), rows(176, 152)), SHAPE.body),
  slot(id('attribution'), 'body', box(columns(2, 9), rows(344, 32)), SHAPE.subtitle),
  footer(id),
]);

const closing = layout('Заключение', 'closing', (id) => [
  image(id('logo'), 'logo', box(columns(0, 2), rows(40, 40)), LOGO_PART, 'contain', SHAPE.logo),
  decor(id('title-rule'), box(columns(0, 2), rows(176, 4)), SHAPE.titleRule),
  slot(id('title'), 'title', box(columns(0, 9), rows(192, 136)), SHAPE.title),
  slot(id('subtitle'), 'subtitle', box(columns(0, 8), rows(344, 56)), SHAPE.subtitle),
  footer(id),
]);

export const DEMO_LAYOUTS: SlideLayout[] = [
  titleSlide,
  titleAndContent,
  twoContent,
  comparison,
  quote,
  closing,
];
