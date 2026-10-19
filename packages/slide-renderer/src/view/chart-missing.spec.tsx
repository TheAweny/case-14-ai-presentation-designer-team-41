import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { ContactSheet } from './contact-sheet.js';
import { SlideView } from '../slide-view.js';
import { box, measured, paragraph, text } from '../testing/deck.js';

const PROFILE = {
  schemaVersion: 1,
  templateHash: 'a'.repeat(64),
  aspect: '16:9',
  palette: [
    { role: 'background', hex: 'FFFFFF', meta: measured('observed') },
    { role: 'surface', hex: 'EEEEEE', meta: measured('observed') },
    { role: 'text', hex: '111111', meta: measured('observed') },
    { role: 'text-muted', hex: '666666', meta: measured('observed') },
    { role: 'accent', hex: '3355E0', meta: measured('observed') },
    { role: 'line', hex: 'CCCCCC', meta: measured('observed') },
    { role: 'negative', hex: 'CC3333', meta: measured('observed') },
  ],
  surfaces: [
    {
      tone: 'light',
      background: 'FFFFFF',
      text: '111111',
      accent: '3355E0',
      meta: measured('observed'),
    },
  ],
  typeFamilies: [
    { role: 'primary', font: 'Deck Face', declared: 'Deck Face', meta: measured('observed') },
  ],
  typeScale: [
    {
      role: 'body',
      font: 'Deck Face',
      sizePt: 16,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text',
      meta: measured('observed'),
    },
  ],
  grid: {
    slideCx: 12_192_000,
    slideCy: 6_858_000,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 0,
    columns: 12,
    gutter: 0,
    baseline: 100_000,
    meta: measured('observed'),
  },
  strokes: [],
  radii: [],
  shadows: { present: false, meta: measured('observed') },
  protectedZones: [],
  warnings: [],
} as DesignSystem;

function chartSlide(
  variant: 'dense' | 'balanced' | 'airy',
  frame: ReturnType<typeof box>,
): SlideIr {
  return {
    schemaVersion: 1,
    slideId: 'facts',
    variant,
    index: 0,
    patternId: 'synthetic',
    slideCx: 12_192_000,
    slideCy: 6_858_000,
    elements: [
      text('value', 'kpi-value', box(40, 20, 200, 40), [paragraph('0 шт')]),
      {
        kind: 'chart',
        elementId: `chart-${variant}`,
        role: 'chart',
        box: frame,
        sourceShapeId: null,
        chartType: 'line',
        categories: ['2020', '2021', '2024', '2025'],
        positions: [2020, 2021, 2024, 2025],
        series: [
          { name: 'Запас', unit: 'сутки', values: [10, 0, -2, null] },
          {
            name: 'План с очень длинным названием ряда, которое нельзя обрезать',
            unit: 'сутки',
            values: [4, null, 1, 2],
          },
        ],
        xTitle: 'Год',
        yTitle: 'Запас, сутки',
      },
    ],
  };
}

describe('chart values stay independent of the picture', () => {
  it('draws a real zero and a negative, and leaves a hole where the value is missing', () => {
    const html = renderToStaticMarkup(
      <SlideView slide={chartSlide('balanced', box(40, 80, 600, 280))} profile={PROFILE} />,
    );
    expect(html).toContain('data-missing-count="2"');
    expect(html).toContain('data-axis="xy"');
    expect(html).toContain('data-value="0"');
    expect(html).toContain('data-value="-2"');
    expect(html).toContain('data-missing="true"');
    expect(html).toContain('План с очень длинным названием ряда, которое нельзя обрезать');
    expect(html).toContain('0 шт');
  });
});

describe('contact sheet', () => {
  it('shows three variants of the same facts', () => {
    const slides = [
      chartSlide('dense', box(40, 80, 280, 300)),
      chartSlide('balanced', box(40, 80, 600, 180)),
      chartSlide('airy', box(40, 200, 600, 220)),
    ];
    const html = renderToStaticMarkup(
      <ContactSheet title="Три варианта" profile={PROFILE} slides={slides} />,
    );
    expect(html).toContain('data-contact-sheet="true"');
    expect(html.match(/data-variant="/g)).toHaveLength(3);
    expect(html.match(/0 шт/g)).toHaveLength(3);
  });
});
