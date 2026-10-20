import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generationProfileSchema, type SlotVisual } from '@lct/contracts';
import {
  chartedSeries,
  plannedSeriesChart,
  seriesFacts,
  withDisplayLabels,
} from './visual-grounding.js';
import { createGenerationWorkflow, groundedVisual } from './workflow.js';
import type { TextProvider } from './provider.js';

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
  const weekly = (
    metric: string,
    unit: string,
    values: number[],
    quote: string,
    yTitle = unit,
  ): Extract<SlotVisual, { kind: 'native' }> => ({
    kind: 'native',
    slotId: 'body',
    block: {
      kind: 'chart',
      intent: 'time-series',
      categories: values.map((_, index) => ({ label: `Неделя ${index + 1}` })),
      series: [
        {
          name: metric,
          unit,
          values: values.map((value) => ({ state: 'present', literal: String(value), value })),
        },
      ],
      requestedType: 'line',
      xTitle: 'Неделя теста',
      yTitle,
      sources: [{ itemId: 'brief', quote, status: 'unverified' }],
    },
  });

  it('exports a proven line without an overflowing companion table and keeps its exact quote', async () => {
    const quote =
      'Доля ответов без исправлений, %: Неделя 1 — 70, Неделя 2 — 76, Неделя 3 — 82, Неделя 4 — 86.';
    const source = JSON.stringify({ userRequirements: [{ messageId: 'user', text: quote }] });
    const original = generationProfileSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
          'utf8',
        ),
      ).valid[0].payload,
    );
    const base = original.compositions[0];
    if (!base) throw new Error('Missing fixture composition');
    const pattern = {
      ...base,
      patternId: 'measurements',
      imageCount: 0,
      slots: [
        {
          slotId: 'title',
          role: 'title' as const,
          sample: '',
          maxChars: 100,
          maxLines: 3,
          font: 'Fixture',
          fontSize: 28,
        },
        {
          slotId: 'body',
          role: 'body' as const,
          sample: '',
          maxChars: 750,
          maxLines: 18,
          font: 'Fixture',
          fontSize: 18,
        },
      ],
    };
    const compact = {
      ...pattern,
      patternId: 'compact',
      slots: pattern.slots.map((slot) =>
        slot.role === 'body' ? { ...slot, maxChars: 135, maxLines: 6 } : slot,
      ),
    };
    const provider: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        if (agent === 'planner')
          return schema.parse({
            title: 'Тест',
            slides: Array.from({ length: 5 }, (_, index) => ({
              patternId: compact.patternId,
              purpose:
                index === 2 ? 'Доля ответов без исправлений: 70 против 86' : `Слайд ${index}`,
              requiredClaims: [],
            })),
          });
        const slides = (
          input as { slides: { index: number; composition: { patternId: string } }[] }
        ).slides;
        expect(slides.find((slide) => slide.index === 2)?.composition.patternId).toBe(
          pattern.patternId,
        );
        return schema.parse({
          slides: Object.fromEntries(
            slides.map(({ index, composition }) => [
              String(index),
              {
                patternId: composition.patternId,
                textsBySlot: { title: 'Доля ответов выросла', body: 'Наблюдение тестовой группы' },
                speakerNotes: '',
                visual:
                  index === 2
                    ? weekly(
                        'Доля ответов без исправлений',
                        '%',
                        [70, 76, 82, 86],
                        quote,
                        'Доля ответов, %',
                      )
                    : null,
              },
            ]),
          ),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      deckWriterInstructions: 'registry-fixture',
      signal: new AbortController().signal,
    });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: {
        brief: source,
        slideCount: 5,
        outline: {
          title: 'Тест',
          audience: '',
          goal: '',
          slides: Array.from({ length: 5 }, (_, index) => ({
            title: index === 2 ? 'Доля ответов выросла' : `Слайд ${index}`,
            points: index === 2 ? ['Доля ответов без исправлений: 70, 76, 82, 86'] : [],
            kind: 'statement' as const,
          })),
        },
        profile: { ...original, compositions: [compact, pattern] },
      },
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('workflow failed');
    expect(result.result[2]?.slide.visual).toMatchObject({
      kind: 'chart',
      chartType: 'line',
      yTitle: '%',
      series: [{ name: 'Доля ответов без исправлений', values: [70, 76, 82, 86] }],
    });
    expect(result.result[2]?.slide.speakerNotes).toContain(quote);
  });

  it.each([
    {
      metric: 'Среднее время обработки',
      unit: 'минут',
      values: [12, 11, 9, 8],
      quote:
        'Среднее время обработки по неделям, минут: Неделя 1 — 12, Неделя 2 — 11, Неделя 3 — 9, Неделя 4 — 8.',
      yTitle: 'Среднее время, минут',
    },
    {
      metric: 'Доля ответов без исправлений',
      unit: '%',
      values: [70, 76, 82, 86],
      quote:
        'Доля ответов без исправлений, %: Неделя 1 — 70, Неделя 2 — 76, Неделя 3 — 82, Неделя 4 — 86.',
      yTitle: 'Доля ответов, %',
    },
  ])(
    'retains the sourced native weekly chart for $metric without a dataset',
    ({ metric, unit, values, quote, yTitle }) => {
      const brief = JSON.stringify({
        approvedOutline: { title: 'Not a source' },
        userRequirements: [{ messageId: 'user-message', text: quote }],
      });
      const visual = weekly(metric, unit, values, quote, yTitle);
      expect(groundedVisual(visual, brief)).toMatchObject({
        kind: 'native',
        block: {
          kind: 'chart',
          yTitle: unit,
          series: [{ name: metric, unit, values: values.map((value) => ({ value })) }],
          sources: [{ itemId: 'brief', quote, status: 'grounded' }],
        },
      });
      expect(visual.kind === 'native' && visual.block.kind === 'chart' && visual.block.yTitle).toBe(
        yTitle,
      );
      expect(seriesFacts(brief)).toHaveLength(4);
      expect(plannedSeriesChart(`${metric}: ${values.join('; ')}`, brief, 'body')).toMatchObject({
        kind: 'chart',
        yTitle: unit,
        series: [{ name: metric, values }],
      });
    },
  );

  it('still rejects changed values, units, categories, metrics and unsourced quotes in weekly charts', () => {
    const quote =
      'Среднее время обработки по неделям, минут: Неделя 1 — 12, Неделя 2 — 11, Неделя 3 — 9, Неделя 4 — 8.';
    const visual = weekly('Среднее время обработки', 'минут', [12, 11, 9, 8], quote);
    expect(
      groundedVisual(
        weekly('Среднее время обработки по неделям', 'минут', [12, 11, 9, 8], quote),
        quote,
      ),
    ).not.toBeNull();
    if (visual.kind !== 'native' || visual.block.kind !== 'chart') throw new Error('chart');
    const change = (edit: (candidate: typeof visual) => void) => {
      const candidate = structuredClone(visual);
      edit(candidate);
      return candidate;
    };
    for (const invalid of [
      weekly('Среднее время обработки', 'минут', [12, 11, 9, 7], quote),
      weekly('Среднее время обработки', 'секунд', [12, 11, 9, 8], quote),
      weekly('Стоимость обработки', 'минут', [12, 11, 9, 8], quote),
      change((candidate) => {
        if (candidate.block.kind === 'chart') candidate.block.categories[0] = { label: 'Неделя 5' };
      }),
      change((candidate) => {
        if (candidate.block.kind === 'chart') candidate.block.yTitle = 'Скорость, %';
      }),
      change((candidate) => {
        if (candidate.block.kind === 'chart')
          candidate.block.sources[0] = { itemId: 'brief', quote: 'Invented', status: 'grounded' };
      }),
    ])
      expect(groundedVisual(invalid, quote)).toBeNull();
    const draftOnly = JSON.stringify({
      userRequirements: [{ messageId: 'user', text: 'No figures' }],
      approvedOutline: { points: [quote] },
    });
    expect(groundedVisual(visual, draftOnly)).toBeNull();
    expect(plannedSeriesChart('12; 11; 9; 8', draftOnly, 'body')).toBeNull();
  });

  it('grounds compact inline weekly records and exact ordinal positions without inventing positions', () => {
    const quote =
      'Доля ответов без исправлений,%: Неделя1 —70, Неделя2 —76, Неделя3 —82, Неделя4 —86.';
    const brief = `Учебный кейс. ${quote} Это наблюдения тестовой группы.`;
    const visual = weekly('Доля ответов без исправлений', '%', [70, 76, 82, 86], quote);
    if (visual.block.kind !== 'chart') throw new Error('chart');
    visual.block.categories = [1, 2, 3, 4].map((position) => ({
      label: `Неделя${position}`,
      position,
    }));
    expect(groundedVisual(visual, brief)).not.toBeNull();
    const changed = structuredClone(visual);
    if (changed.block.kind !== 'chart') throw new Error('chart');
    changed.block.categories[1] = { label: 'Неделя2', position: 20 };
    expect(groundedVisual(changed, brief)).toBeNull();
    expect(
      groundedVisual(
        visual,
        'Учебный кейс. Доля ответов без исправлений,%: Неделя1 —71, Неделя2 —76, Неделя3 —82, Неделя4 —86.',
      ),
    ).toBeNull();
    expect(
      seriesFacts(JSON.stringify({ userRequirements: [{ messageId: 'user', text: brief }] })),
    ).toHaveLength(4);
  });

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

  it('draws a series an earlier slide already charts only once', () => {
    const purpose = 'При неудачах небо облачнее — cloud_cover, среднее: 0 — 43,33, 1 — 30,83';
    const first = plannedSeriesChart(purpose, brief, 'body');
    const series = chartedSeries(first);
    expect(series).toBe('result|cloud_cover, среднее');
    expect(plannedSeriesChart(purpose, brief, 'body', [series ?? ''])).toBeNull();
  });

  it('shows the writer labels over the column names when the values are the same', () => {
    const planned = plannedSeriesChart(
      'При неудачах небо облачнее — cloud_cover, среднее: 0 — 43,33, 1 — 30,83',
      brief,
      'body',
    );
    if (!planned) throw new Error('planned chart expected');
    const offered = {
      kind: 'chart',
      categories: ['Неудача', 'Успех'],
      series: [{ name: 'Средняя облачность, %', values: [43.33, 30.83] }],
      xTitle: 'Исход наблюдения',
      yTitle: '',
    };
    expect(withDisplayLabels(planned, offered)).toMatchObject({
      categories: ['Неудача', 'Успех'],
      series: [{ name: 'Средняя облачность, %', values: [43.33, 30.83] }],
      xTitle: 'Исход наблюдения',
    });
    // Other figures lend no labels: the brief's chart stays as it was planned.
    const wrong = { ...offered, series: [{ name: 'Облачность', values: [50, 30.83] }] };
    expect(withDisplayLabels(planned, wrong)).toEqual(planned);
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
