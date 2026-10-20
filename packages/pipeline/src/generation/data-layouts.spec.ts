import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generationProfileSchema } from '@lct/contracts';
import {
  conceptualLayouts,
  dataLayoutNeed,
  fitsDataLayout,
  preserveDataLayout,
  remapPlan,
  withDataLayouts,
} from './workflow.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
) as { valid: { payload: unknown }[] };
const profile = generationProfileSchema.parse(fixture.valid[0]?.payload);
const base = profile.compositions[0];
const title = base?.slots[0];
if (!base || !title) throw new Error('fixture');
const body = (slotId: string, sample: string, maxChars: number, maxLines: number) => ({
  ...title,
  slotId,
  role: 'body' as const,
  sample,
  maxChars,
  maxLines,
});
const statement = { ...base, patternId: 'statement', slots: [title, body('3', 'Тезис', 244, 4)] };
const chart = { ...base, patternId: 'chart', slots: [title, body('3', 'График', 750, 18)] };
const kpi = {
  ...base,
  patternId: 'kpi',
  slots: [
    title,
    body('3', '42%', 7, 1),
    body('4', '3×', 7, 1),
    body('5', '120', 7, 1),
    body('6', 'что выросло', 110, 5),
  ],
};
const catalog = [statement, chart, kpi];
const brief = '- cloud_cover, среднее: 0 — 43,33, 1 — 30,83.';
const slide = (purpose: string, patternId = 'statement') => ({ patternId, purpose });

describe('data layouts after planning', () => {
  it('moves a slide quoting a series to a chart layout and a slide of figures to the KPI one', () => {
    const slides = [
      slide('Обложка'),
      slide('Облачность решает — cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
      slide('Три цифры, которые решают: 80% успешных; 3 тестовые ночи; 6 неудачных (20%)'),
      slide(
        'Три цифры — 80% успешных (24/30); облачность при неудачах 43,33; при успехах 30,83',
        'chart',
      ),
      slide('Итог'),
    ];
    expect(withDataLayouts(slides, catalog, brief).map((s) => s.patternId)).toEqual([
      'statement',
      'chart',
      'kpi',
      'kpi',
      'statement',
    ]);
  });

  it('keeps ordinary slides, the cover and the closing slide where the planner put them', () => {
    const slides = [
      slide('cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
      slide('Облачность мешает — наблюдать в ясные ночи; планировать по погоде'),
      slide('Цифры в чарте — cloud_cover, среднее: 0 — 43,33, 1 — 30,83', 'chart'),
      slide('cloud_cover, среднее: 0 — 43,33, 1 — 30,83'),
    ];
    expect(withDataLayouts(slides, catalog, brief).map((s) => s.patternId)).toEqual([
      'statement',
      'statement',
      'chart',
      'statement',
    ]);
  });
});

describe('data layouts survive the later layout passes', () => {
  // Boxes are EMUs, the unit visualSlots measures. A short text layout can still hold most of
  // a chart layout's characters, which is what used to pull a series slide off its chart.
  const box = (x: number, font: number) => ({
    x,
    y: 0,
    cx: Math.ceil(font * 12700 * 14),
    cy: Math.ceil(font * 12700 * 8),
  });
  const chart = {
    ...base,
    patternId: 'chart',
    slots: [
      { ...title, fontSize: 28 },
      { ...body('3', 'График', 750, 18), fontSize: 18, box: box(0, 18) },
    ],
  };
  const low = {
    ...base,
    patternId: 'low',
    slots: [
      { ...title, fontSize: 20 },
      { ...body('3', 'Тезис', 500, 4), fontSize: 18, box: box(400000, 18) },
    ],
  };
  const high = {
    ...base,
    patternId: 'high',
    slots: [
      { ...title, fontSize: 44 },
      { ...body('3', 'Тезис', 500, 4), fontSize: 16, box: box(900000, 16) },
    ],
  };
  const lightChart = {
    ...chart,
    patternId: 'chart-light',
    slots: [
      { ...title, fontSize: 28 },
      { ...body('3', 'График', 200, 8), fontSize: 18, box: box(0, 18) },
    ],
  };
  const layouts = [statement, chart, low, high, lightChart, kpi];
  const series = 'Облачность решает — cloud_cover, среднее: 0 — 43,33, 1 — 30,83';
  const figures = 'Три цифры, которые решают: 80% успешных; 3 тестовые ночи; 6 неудачных (20%)';

  it('keeps a series slide on a chart when a variant would otherwise take a text layout', () => {
    const ids = ['statement', 'chart'];
    const notes = new Map();
    expect(conceptualLayouts(ids, layouts, 'dense', [], notes)[1]).toBe('low');
    expect(conceptualLayouts(ids, layouts, 'airy', [], notes)[1]).toBe('high');
    expect(conceptualLayouts(ids, layouts, 'dense', [], notes, [undefined, 'chart'])[1]).toBe(
      'chart',
    );
    expect(conceptualLayouts(ids, layouts, 'airy', [], notes, [undefined, 'chart'])[1]).toBe(
      'chart',
    );
    expect(
      remapPlan(ids, layouts, layouts, 'airy', [], notes, 'density', [undefined, 'chart'])[1],
    ).toBe('chart');
  });

  it('puts a slide that left its data layout back onto one, and keeps a fitting one', () => {
    expect(dataLayoutNeed(series, brief, 1, 4)).toBe('chart');
    expect(dataLayoutNeed(figures, brief, 1, 4)).toBe('figures');
    expect(dataLayoutNeed(series, brief, 0, 4)).toBeUndefined();
    expect(fitsDataLayout(high, 'chart')).toBe(false);
    expect(fitsDataLayout(chart, 'chart')).toBe(true);
    expect(preserveDataLayout(high, layouts, 'chart', 'dense').patternId).toBe('chart');
    expect(preserveDataLayout(high, layouts, 'chart', 'airy').patternId).toBe('chart-light');
    expect(preserveDataLayout(high, layouts, 'chart', 'balanced').patternId).toBe('chart');
    expect(preserveDataLayout(lightChart, layouts, 'chart', 'dense').patternId).toBe('chart-light');
    expect(preserveDataLayout(statement, layouts, 'figures', 'balanced').patternId).toBe('kpi');
    expect(preserveDataLayout(kpi, layouts, 'figures', 'airy').patternId).toBe('kpi');
  });
});
