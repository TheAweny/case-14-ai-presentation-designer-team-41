import type {
  Box,
  DesignSystem,
  ElementRole,
  Paragraph,
  SlideElement,
  SlideIr,
} from '@lct/contracts';

/**
 * Test slides with every kind of element and every role of SlideIR. The demo deck of the web app
 * cannot be imported from here — a library does not depend on an app — so this is its compact
 * counterpart, laid out on a 16:9 slide of 960 × 540 pt.
 */

const EMU_PER_PT = 12_700;
const pt = (value: number) => Math.round(value * EMU_PER_PT);

export const WIDE = { cx: pt(960), cy: pt(540) };

export function box(x: number, y: number, cx: number, cy: number): Box {
  return { x: pt(x), y: pt(y), cx: pt(cx), cy: pt(cy) };
}

export function paragraph(
  text: string,
  options: { sizePt?: number | null; bold?: boolean | null; italic?: boolean; level?: number } = {},
): Paragraph {
  return {
    level: options.level ?? 0,
    runs: [
      {
        text,
        font: '',
        sizePt: options.sizePt === undefined ? 16 : options.sizePt,
        bold: options.bold ?? false,
        italic: options.italic ?? false,
        color: '',
      },
    ],
  };
}

export function text(
  elementId: string,
  role: ElementRole,
  frame: Box,
  paragraphs: Paragraph[],
): Extract<SlideElement, { kind: 'text' }> {
  return {
    kind: 'text',
    elementId,
    role,
    box: frame,
    sourceShapeId: null,
    paragraphs,
    overflow: null,
  };
}

function slide(slideId: string, index: number, elements: SlideElement[]): SlideIr {
  return {
    schemaVersion: 1,
    slideId,
    variant: 'balanced',
    index,
    patternId: slideId,
    slideCx: WIDE.cx,
    slideCy: WIDE.cy,
    elements,
  };
}

export const COVER = slide('cover', 0, [
  {
    kind: 'decor',
    elementId: 'cover-panel',
    role: 'decoration',
    box: box(640, 0, 320, 540),
    sourceShapeId: 21,
  },
  {
    kind: 'image',
    elementId: 'cover-logo',
    role: 'logo',
    box: box(48, 40, 96, 40),
    sourceShapeId: 12,
    mediaPart: 'ppt/media/image1.png',
    fit: 'contain',
  },
  {
    kind: 'decor',
    elementId: 'cover-rule',
    role: 'decoration',
    box: box(48, 160, 96, 4),
    sourceShapeId: 20,
  },
  text('cover-title', 'title', box(48, 176, 552, 104), [
    paragraph('Цифровой дизайнер презентаций', { sizePt: 44, bold: true }),
  ]),
  text('cover-subtitle', 'subtitle', box(48, 296, 552, 56), [
    paragraph('Колода в стиле вашего шаблона за пять минут', { sizePt: 18 }),
  ]),
  text('cover-footer', 'footer', box(48, 484, 552, 16), [paragraph('ЛЦТ-2026', { sizePt: 10 })]),
]);

export const CONTENT = slide('content', 1, [
  text('content-title', 'title', box(48, 40, 864, 72), [
    paragraph('Все виды элементов на одном слайде', { sizePt: 32, bold: true }),
  ]),
  text('content-bullets', 'bullet-list', box(48, 144, 272, 160), [
    paragraph('Первый пункт списка'),
    paragraph('Вложенный пункт', { level: 1 }),
  ]),
  text('content-body', 'body', box(48, 320, 272, 60), [paragraph('Абзац основного текста')]),
  text('content-kpi', 'kpi-value', box(344, 144, 180, 56), [
    paragraph('5 мин', { sizePt: 48, bold: true }),
  ]),
  text('content-kpi-caption', 'kpi-caption', box(344, 208, 180, 40), [
    paragraph('бюджет на колоду', { sizePt: 14 }),
  ]),
  text('content-quote', 'quote', box(344, 264, 270, 100), [
    paragraph('«Система адаптируется к стилю шаблона»', { sizePt: 22, italic: true }),
  ]),
  {
    kind: 'decor',
    elementId: 'content-card',
    role: 'decoration',
    box: box(624, 136, 304, 256),
    sourceShapeId: 30,
  },
  {
    kind: 'image',
    elementId: 'content-image',
    role: 'image',
    box: box(640, 144, 272, 120),
    sourceShapeId: 8,
    mediaPart: 'media/preview.png',
    fit: 'cover',
  },
  {
    kind: 'table',
    elementId: 'content-table',
    role: 'table',
    box: box(640, 280, 272, 100),
    sourceShapeId: null,
    headers: ['Этап', 'Где'],
    rows: [
      ['Разбор', 'Python'],
      ['План', 'TypeScript'],
    ],
  },
  ...(['bar', 'column', 'line', 'area', 'pie'] as const).map((chartType, i): SlideElement => ({
    kind: 'chart',
    elementId: `content-chart-${chartType}`,
    role: 'chart',
    box: box(48 + i * 176, 396, 160, 80),
    sourceShapeId: null,
    chartType,
    categories: ['А', 'Б', 'В'],
    series: [
      { name: 'Первая', values: [20, 40, 30] },
      { name: 'Вторая', values: [10, 25, 35] },
    ],
    xTitle: '',
    yTitle: '',
  })),
  text('content-footer', 'footer', box(48, 484, 552, 16), [paragraph('ЛЦТ-2026', { sizePt: 10 })]),
  text('content-page-number', 'page-number', box(864, 484, 48, 16), [
    paragraph('2', { sizePt: 10 }),
  ]),
]);

export const TEST_SLIDES: readonly SlideIr[] = [COVER, CONTENT];

/** A type scale with inherited values to resolve. Only the roles the tests read. */
export const TYPE_SCALE: Pick<DesignSystem, 'typeScale'> = {
  typeScale: [
    {
      role: 'body',
      font: 'Sans',
      sizePt: 20,
      bold: false,
      italic: false,
      lineSpacing: 1.5,
      colorRole: 'text',
      source: 'observed',
    },
  ],
};
