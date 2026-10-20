import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  datasetSchema,
  generationProfileSchema,
  type Dataset,
  type SlotVisual,
} from '@lct/contracts';
import type { z } from 'zod';
import { datasetFacts, prepareDatasets } from './dataset-evidence.js';
import { createGenerationWorkflow, groundedVisual, SharedContent } from './workflow.js';
import type { TextProvider } from './provider.js';
export function datasetFixture(): Dataset {
  return datasetSchema.parse({
    datasetId: 'sales',
    status: 'ok',
    source: { fileName: 'sales.csv', mediaType: 'text/csv', bytes: 100, sha256: 'a'.repeat(64) },
    diagnostics: [],
    sheets: [
      {
        sheetId: 'sheet-1',
        name: 'Sales',
        index: 0,
        range: 'A1:C4',
        headerRow: 1,
        columns: [
          { columnId: 'A', ref: 'A', index: 1, header: 'Месяц', kind: 'text' },
          { columnId: 'B', ref: 'B', index: 2, header: 'Выручка, млн руб.', kind: 'number' },
          { columnId: 'C', ref: 'C', index: 3, header: 'Затраты, млн руб.', kind: 'number' },
        ],
        rows: [
          ['Январь', 0, 20],
          ['Февраль', -10, 30],
          ['Март', null, 40],
        ].map((row, i) => ({
          row: i + 2,
          cells: row.map((value, j) => ({
            ref: `${['A', 'B', 'C'][j]}${i + 2}`,
            raw: value === null ? null : String(value),
            value,
            kind: value === null ? 'empty' : typeof value === 'number' ? 'number' : 'text',
          })),
        })),
      },
    ],
  });
}
const fixture = datasetFixture();
const facts = datasetFacts([fixture]).filter((fact) => fact.metric === 'Выручка');
export function nativeChart(): Extract<
  SlotVisual,
  {
    kind: 'native';
  }
> {
  return {
    kind: 'native',
    slotId: 'body',
    block: {
      kind: 'chart',
      intent: 'time-series',
      categories: facts.map((fact) => ({ label: fact.category })),
      series: [
        {
          name: 'Выручка',
          unit: 'млн руб.',
          values: facts.map((fact) =>
            fact.state === 'missing'
              ? { state: 'missing' }
              : { state: 'present', value: fact.value, literal: fact.literal },
          ),
        },
      ],
      sources: facts.map((fact) => ({
        itemId: fact.itemId,
        quote: fact.quote,
        status: 'grounded',
      })),
      xTitle: 'Месяц',
      yTitle: 'млн руб.',
    },
  };
}
describe('addressed dataset measurements', () => {
  it('prepares through the typed engine method without losing failed diagnostics', async () => {
    const failed = {
      ...fixture,
      status: 'failed' as const,
      sheets: [],
      diagnostics: [{ code: 'bad-file', severity: 'error' as const, message: 'unreadable' }],
    };
    const calls: unknown[] = [];
    const signal = new AbortController().signal;
    const prepared = await prepareDatasets(
      {
        extractDataset: async (request, passedSignal) => {
          calls.push([request, passedSignal]);
          return request.path === '/data/sales.csv' ? fixture : failed;
        },
      },
      ['/data/sales.csv', '/data/bad.csv'],
      signal,
    );
    expect(calls).toEqual([
      [{ path: '/data/sales.csv' }, signal],
      [{ path: '/data/bad.csv' }, signal],
    ]);
    expect(prepared[1]?.diagnostics[0]?.code).toBe('bad-file');
    expect(datasetFacts(prepared)).toHaveLength(6);
  });
  it('retains addressed zero, negative and missing as distinct states', () => {
    expect(facts.map((fact) => [fact.ref, fact.state, fact.value])).toEqual([
      ['B2', 'present', 0],
      ['B3', 'present', -10],
      ['B4', 'missing', undefined],
    ]);
    expect(groundedVisual(nativeChart(), '', [fixture])).toEqual(nativeChart());
  });
  it.each([
    'months',
    'metric',
    'sign',
    'unit',
    'missing-to-zero',
    'unknown-source',
    'literal',
    'position',
  ])('rejects changed %s', (change) => {
    const chart = nativeChart();
    if (chart.block.kind !== 'chart') throw new Error('chart fixture');
    const series = chart.block.series[0];
    if (!series) throw new Error('series fixture');
    if (change === 'months')
      [chart.block.categories[0], chart.block.categories[1]] = [
        required(chart.block.categories[1]),
        required(chart.block.categories[0]),
      ];
    if (change === 'metric') series.name = 'Затраты';
    if (change === 'sign') series.values[1] = { state: 'present', literal: '10', value: 10 };
    if (change === 'unit') series.unit = chart.block.yTitle = 'тыс руб.';
    if (change === 'missing-to-zero')
      series.values[2] = { state: 'present', literal: '0', value: 0 };
    if (change === 'unknown-source') required(chart.block.sources[0]).itemId = 'dataset/unknown/B2';
    if (change === 'literal') required(series.values[1]).literal = '10';
    if (change === 'position') required(chart.block.categories[0]).position = 7;
    expect(groundedVisual(chart, '', [fixture])).toBeNull();
  });
  it('proves model-unverified sources itself after checking addressed dataset relationships', () => {
    const chart = nativeChart();
    if (chart.block.kind !== 'chart') throw new Error('chart fixture');
    for (const source of chart.block.sources) source.status = 'unverified';
    expect(groundedVisual(chart, '', [fixture])).toEqual(nativeChart());
  });
  it('rejects KPI caption substitution and preserves an addressed negative period', () => {
    const fact = required(facts[1]);
    const kpi: SlotVisual = {
      kind: 'native',
      slotId: 'body',
      block: {
        kind: 'kpi',
        items: [
          {
            caption: fact.metric,
            value: { state: 'present', literal: '-10', value: -10 },
            unit: fact.unit,
            unitAmbiguous: false,
            periodKnown: true,
            period: fact.category,
            sources: [{ itemId: fact.itemId, quote: fact.quote, status: 'grounded' }],
          },
        ],
      },
    };
    expect(groundedVisual(kpi, '', [fixture])).toEqual(kpi);
    if (kpi.block.kind !== 'kpi') throw new Error('KPI fixture');
    required(kpi.block.items[0]).caption = 'Затраты';
    expect(groundedVisual(kpi, '', [fixture])).toBeNull();
  });
  it.each([
    'failed',
    'ambiguous',
    'duplicate',
    'dimension',
    'cell-address',
    'diagnostic',
    'merged',
  ])('does not upgrade %s provenance', (change) => {
    const dataset = datasetFixture();
    const sheet = required(dataset.sheets[0]);
    if (change === 'failed') dataset.status = 'failed';
    if (change === 'ambiguous') required(required(sheet.rows[0]).cells[1]).candidates = [0, 10];
    if (change === 'dimension') required(required(sheet.rows[0]).cells[0]).raw = null;
    if (change === 'cell-address') required(required(sheet.rows[0]).cells[1]).ref = 'B9';
    if (change === 'diagnostic')
      dataset.diagnostics = [
        {
          code: 'ambiguous-number',
          severity: 'warning',
          message: 'ambiguous',
          sheet: 'Sales',
          ref: 'B2',
        },
      ];
    if (change === 'merged') sheet.mergedRanges = ['A2:A3'];
    expect(
      groundedVisual(nativeChart(), '', change === 'duplicate' ? [dataset, dataset] : [dataset]),
    ).toBeNull();
  });
  it('retains extra dimensions instead of silently attributing all rows to one month', () => {
    const dataset = datasetFixture();
    const sheet = required(dataset.sheets[0]);
    sheet.columns.push({ columnId: 'D', ref: 'D', index: 4, header: 'Регион', kind: 'text' });
    sheet.rows.forEach((row) =>
      row.cells.push({ ref: `D${row.row}`, raw: 'Север', value: 'Север', kind: 'text' }),
    );
    expect(groundedVisual(nativeChart(), '', [dataset])).toBeNull();
    const chart = nativeChart();
    if (chart.block.kind !== 'chart') throw new Error('fixture');
    chart.block.categories.forEach((category) => (category.label += ' / Север'));
    expect(groundedVisual(chart, '', [dataset])).toEqual(chart);
  });
  it('checks complete table rows and headers rather than a pool of cells', () => {
    const table: SlotVisual = {
      kind: 'table',
      slotId: 'body',
      headers: ['Месяц', 'Выручка, млн руб.'],
      rows: [
        ['Январь', '0'],
        ['Февраль', '-10'],
      ],
    };
    expect(groundedVisual(table, '', [fixture])).toEqual(table);
    table.rows = [
      ['Январь', '-10'],
      ['Февраль', '0'],
    ];
    expect(groundedVisual(table, '', [fixture])).toBeNull();
  });
});
describe('text-only measurement records', () => {
  const chart: SlotVisual = {
    kind: 'chart',
    slotId: 'body',
    chartType: 'column',
    categories: ['Январь', 'Февраль'],
    series: [{ name: 'Выручка', values: [10, 20] }],
    xTitle: '',
    yTitle: 'млн руб.',
  };
  const brief = 'Выручка: Январь 10, Февраль 20 млн руб.';
  it('accepts explicit category/measure/value/unit records', () => {
    expect(groundedVisual(chart, brief)).toEqual(chart);
  });
  it.each(['months', 'metric', 'sign', 'unit'])('rejects text %s substitution', (change) => {
    const changed = structuredClone(chart);
    if (change === 'months') required(changed.series[0]).values = [20, 10];
    if (change === 'metric') required(changed.series[0]).name = 'Затраты';
    if (change === 'sign') required(changed.series[0]).values = [-10, 20];
    if (change === 'unit') changed.yTitle = '%';
    expect(groundedVisual(changed, brief)).toBeNull();
  });
  it('rejects unordered prose or quotes with no measurement name', () => {
    expect(groundedVisual(chart, 'Январь: 10 млн руб. Февраль: 20 млн руб.')).toBeNull();
    expect(groundedVisual(chart, 'Выручка равна 10 и 20 млн руб. в январе и феврале.')).toBeNull();
  });
});
describe('datasets in actual workflow with fake provider', () => {
  it.each([false, true])(
    'passes addressed facts to writer/checkpoint input and keeps fallback on refusal (%s)',
    async (invalid) => {
      const original = generationProfileSchema.parse(
        JSON.parse(
          readFileSync(
            new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
            'utf8',
          ),
        ).valid[0].payload,
      );
      const pattern = {
        ...required(original.compositions[0]),
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
            maxChars: 500,
            maxLines: 12,
            font: 'Fixture',
            fontSize: 18,
          },
        ],
      };
      let writerInput: unknown;
      const provider: TextProvider = {
        model: 'fake',
        async generate<T>(
          agent: string,
          _instructions: string,
          input: unknown,
          schema: z.ZodType<T>,
        ) {
          if (agent === 'planner')
            return schema.parse({
              title: 'Выручка',
              slides: Array.from({ length: 5 }, () => ({
                patternId: pattern.patternId,
                purpose: 'Показатели выручки',
              })),
            });
          if (agent !== 'writer') throw new Error(`Unexpected agent ${agent}`);
          writerInput = input;
          const visual = nativeChart();
          if (visual.block.kind === 'chart' && invalid)
            required(visual.block.series[0]).name = 'Затраты';
          return schema.parse({
            patternId: pattern.patternId,
            speakerNotes: '',
            textsBySlot: {
              title: 'Выручка по месяцам',
              body: 'Январь: 0. Февраль: -10. Март: нет данных.',
            },
            visual,
          });
        },
      };
      const workflow = createGenerationWorkflow({
        provider,
        preparedDatasets: [fixture],
        sharedContent: new SharedContent(),
        variantCopyMode: 'independent',
        plannerInstructions: '',
        writerInstructions: '',
        signal: new AbortController().signal,
      });
      const result = await (
        await workflow.createRun()
      ).start({
        inputData: {
          brief: 'Отчёт о выручке по месяцам',
          profile: { ...original, compositions: [pattern] },
          slideCount: 5,
        },
      });
      expect(writerInput).toMatchObject({
        datasetFacts: expect.arrayContaining([expect.objectContaining({ ref: 'B2', value: 0 })]),
      });
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('workflow failed');
      expect(result.result[0]?.slide.visual === null).toBe(invalid);
      expect(result.result[0]?.slide.texts.find((text) => text.slotId === 'body')?.text).toBe(
        invalid ? 'Январь: 0. Февраль: -10. Март: нет данных.' : '',
      );
    },
  );
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
}
