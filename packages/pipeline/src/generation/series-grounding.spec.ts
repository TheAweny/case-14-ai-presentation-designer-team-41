import { describe, expect, it } from 'vitest';
import type { SlotVisual } from '@lct/contracts';
import { plannedSeriesChart, seriesFacts } from './visual-grounding.js';
import { groundedVisual } from './workflow.js';

const brief = [
  'Наблюдения обсерватории за три ночи.',
  'Готовые ряды для графиков, точные значения по «result»:',
  '- строк: 0 — 6, 1 — 24.',
  '- cloud_cover, среднее: 0 — 43,33, 1 — 30,83.',
  '- moon_illumination, среднее: 0 — 0,5, 1 — 0,5.',
  'Готовые ряды для графиков, точные значения по «series_id»:',
  '- cloud_cover, среднее: test1 — 35, test2 — 50, test3 — 15.',
].join('\n');

const line = '- cloud_cover, среднее: test1 — 35, test2 — 50, test3 — 15.';
const chart: SlotVisual = {
  kind: 'native',
  slotId: 'body',
  block: {
    kind: 'chart',
    intent: 'category-comparison',
    categories: ['test1', 'test2', 'test3'].map((label) => ({ label })),
    series: [
      {
        name: 'cloud_cover, среднее',
        unit: '',
        values: [
          { state: 'present', literal: '35', value: 35 },
          { state: 'present', literal: '50', value: 50 },
          { state: 'present', literal: '15', value: 15 },
        ],
      },
    ],
    xTitle: 'series_id',
    yTitle: '',
    sources: [{ itemId: 'brief', quote: line, status: 'grounded' }],
  },
};

describe('ready series in the brief', () => {
  it('reads every entry of a series line with its decimal comma', () => {
    expect(seriesFacts('- cloud_cover, среднее: 0 — 43,33, 1 — 30,83.')).toEqual([
      expect.objectContaining({ metric: 'cloud_cover, среднее', category: '0', value: 43.33 }),
      expect.objectContaining({ metric: 'cloud_cover, среднее', category: '1', value: 30.83 }),
    ]);
  });

  it('keeps a native chart that quotes a series line', () => {
    expect(groundedVisual(chart, brief)).toEqual(chart);
  });

  it('drops a chart whose value differs from the quoted line', () => {
    if (chart.kind !== 'native' || chart.block.kind !== 'chart') throw new Error('fixture');
    const series = chart.block.series[0];
    if (!series) throw new Error('fixture');
    const changed = {
      ...chart,
      block: {
        ...chart.block,
        series: [
          {
            ...series,
            values: [{ state: 'present', literal: '36', value: 36 }, ...series.values.slice(1)],
          },
        ],
      },
    } as SlotVisual;
    expect(groundedVisual(changed, brief)).toBeNull();
  });

  it('builds the chart a purpose quotes, with the brief values', () => {
    const visual = plannedSeriesChart(
      'При неудачах небо облачнее — cloud_cover, среднее: 0 — 43,33, 1 — 30,83',
      brief,
      'body',
    );
    expect(visual).toEqual({
      kind: 'chart',
      slotId: 'body',
      chartType: 'column',
      categories: ['0', '1'],
      series: [{ name: 'cloud_cover, среднее', values: [43.33, 30.83] }],
      xTitle: 'result',
      yTitle: '',
    });
  });

  it('recognises a series by all its values when the purpose names no column', () => {
    expect(
      plannedSeriesChart('При неудачах облачность выше: 43,33 против 30,83', brief, 'body'),
    ).toMatchObject({ series: [{ name: 'cloud_cover, среднее', values: [43.33, 30.83] }] });
    expect(
      plannedSeriesChart(
        'Солнце ниже: -47,58 и -51,44',
        '- sun_altitude, среднее: test1 — -47,58, test2 — -51,44.',
        'body',
      ),
    ).toMatchObject({ series: [{ values: [-47.58, -51.44] }] });
    // Both the row counts (6, 24) and the cloud series are quoted: the specific one is drawn.
    expect(
      plannedSeriesChart(
        '6 неудач из 30 — облачность при неудачах 43,33, при успехах 30,83; 24 успеха',
        brief,
        'body',
      ),
    ).toMatchObject({ series: [{ name: 'cloud_cover, среднее' }] });
    // «35» inside «0,35» and «50» inside «150» are other numbers.
    expect(plannedSeriesChart('Облачность: 0,35; 150; 15', brief, 'body')).toBeNull();
  });

  it('builds no chart for a purpose without a series, a flat or a near-equal series', () => {
    expect(plannedSeriesChart('Облачность мешает наблюдениям', brief, 'body')).toBeNull();
    expect(
      plannedSeriesChart('moon_illumination одинакова: 0 — 0,5, 1 — 0,5', brief, 'body'),
    ).toBeNull();
    expect(
      plannedSeriesChart(
        'object_color почти равен: test1 — 0,3567, test2 — 0,3542',
        '- object_color, среднее: test1 — 0,3567, test2 — 0,3542.',
        'body',
      ),
    ).toBeNull();
  });
});
