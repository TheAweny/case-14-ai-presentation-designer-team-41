import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Dataset } from '@lct/contracts';
import { datasetText } from './dataset-text.js';
import { labelDataset, labelerInput } from './dataset-labels.js';
import { plannedSeriesChart, seriesFacts, verifyVisual } from '../generation/visual-grounding.js';
import type { TextProvider } from '../generation/provider.js';

type Sheet = Dataset['sheets'][number];
const kinds = ['text', 'number', 'number'] as const;
const rows = [
  ['test1', '100', '0'],
  ['test1', '20', '1'],
  ['test2', '50', '1'],
  ['test2', '70', '0'],
  ['test2', '0', '1'],
  ['test3', '10', '1'],
];
const sheet: Sheet = {
  sheetId: 'sheet-1',
  name: 'Наблюдения',
  index: 0,
  state: 'visible',
  range: 'A1',
  headerRow: 1,
  columns: ['night', 'cloud_cover', 'result'].map((header, index) => ({
    columnId: `sheet-1:${index}`,
    index: index + 1,
    ref: String.fromCharCode(65 + index),
    header,
    kind: kinds[index] ?? 'text',
  })),
  rows: rows.map((cells, index) => ({
    row: index + 2,
    cells: cells.map((raw, column) => {
      const kind = kinds[column] ?? 'text';
      return {
        ref: `${String.fromCharCode(65 + column)}${index + 2}`,
        raw,
        kind,
        value: kind === 'number' ? Number(raw) : raw,
      };
    }),
  })),
};
const dataset = {
  schemaVersion: 1,
  datasetId: 'dataset-test',
  status: 'ok',
  source: { fileName: 'nights.csv', mediaType: 'text/csv', bytes: 1, sha256: 'a'.repeat(64) },
  sheets: [sheet],
  diagnostics: [],
} as Dataset;

const key = (index: number, sheetId = 'sheet-1') => JSON.stringify([sheetId, `sheet-1:${index}`]);
const brief = 'Доля успешных наблюдений. result: 0 = Неудача; result: 1 = Успех';
const answer = {
  rowsLabel: 'Число наблюдений',
  columns: [
    { column: key(0), label: 'Ночь наблюдения', values: [] },
    { column: key(1), label: 'Облачность', values: [] },
    {
      column: key(2),
      label: 'Исход наблюдения',
      values: [
        { value: '0', label: 'Неудача', evidence: 'result: 0 = Неудача' },
        { value: '1', label: 'Успех', evidence: 'result: 1 = Успех' },
        // Not a value of the column: dropped.
        { value: '7', label: 'Выдумка' },
      ],
    },
    // Not a column of the file: dropped.
    { column: 'moon', label: 'Луна', values: [] },
  ],
};

function provider(reply: () => unknown): TextProvider & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    model: 'fake',
    seen,
    async generate<T>(agent: string, _i: string, input: unknown, schema: z.ZodType<T>) {
      expect(agent).toBe('data-labeler');
      seen.push(input);
      return schema.parse(reply());
    },
  };
}
const registryDir = resolve('../../registry/agents');

describe('human labels for the columns of a data file', () => {
  it('shows the labeler names, kinds, a few examples and every code of a coded column', () => {
    const input = labelerInput(dataset, 'Цель: доля успешных наблюдений');
    expect(input.columns.map((column) => column.header)).toEqual([
      'night',
      'cloud_cover',
      'result',
    ]);
    expect(input.columns[2]).toMatchObject({ kind: 'number', distinct: ['0', '1'] });
    expect(input.columns[1]?.examples).toHaveLength(5);
  });

  it('writes the brief and its chart series in the labels, keeping the file names beside them', async () => {
    const labels = await labelDataset({
      provider: provider(() => answer),
      registryDir,
      dataset,
      brief,
    });
    expect(labels?.columns.map((column) => column.column)).toEqual([key(0), key(1), key(2)]);
    const text = datasetText(dataset, labels);
    expect(text).toContain('Готовые ряды для графиков, точные значения по «Исход наблюдения»:');
    expect(text).toContain('- Число наблюдений: Неудача — 2, Успех — 4.');
    expect(text).toContain('- Облачность, среднее: Неудача — 85, Успех — 20.');
    expect(text).toContain('Облачность (cloud_cover)');
    expect(text).not.toContain('Выдумка');
    // The table itself keeps the file's names: a cell is still found by its column.
    expect(text).toContain('| night | cloud_cover | result |');
    // The chart grounding still reads every value of the labelled series.
    const facts = seriesFacts(text).filter((fact) => fact.metric.startsWith('Облачность'));
    expect(facts.map((fact) => [fact.category, fact.value])).toEqual(
      expect.arrayContaining([
        ['Неудача', 85],
        ['Успех', 20],
      ]),
    );
    const chart = plannedSeriesChart(
      'Облачность, среднее: Неудача — 85, Успех — 20',
      text,
      'chart',
    );
    expect(chart).toMatchObject({
      categories: ['Неудача', 'Успех'],
      series: [{ values: [85, 20] }],
    });
    expect(verifyVisual(chart, text, [dataset])).toEqual(chart);
  });

  it('does not infer success/failure from binary values or reuse another column mapping', async () => {
    const labels = await labelDataset({
      provider: provider(() => answer),
      registryDir,
      dataset,
      brief: 'Доля успешных наблюдений. other: 0 = Неудача; other: 1 = Успех',
    });
    expect(labels?.columns[2]?.values).toEqual([]);
    expect(datasetText(dataset, labels)).toContain('- Число наблюдений: 0 — 2, 1 — 4.');
  });

  it('drops model-invented percentage units from column captions', async () => {
    const labels = await labelDataset({
      provider: provider(() => ({
        ...answer,
        columns: [{ column: key(1), label: 'Облачность, %', values: [] }],
      })),
      registryDir,
      dataset,
      brief: 'Сравнить наблюдения',
    });
    expect(labels?.columns[0]?.label).toBe('Облачность');
    expect(datasetText(dataset, labels)).not.toContain('Облачность, %');
  });

  it('keeps same-named columns on different sheets independent', async () => {
    const second = structuredClone(sheet);
    second.sheetId = 'sheet-2';
    second.index = 1;
    second.name = 'Другой лист';
    const multi = { ...dataset, sheets: [sheet, second] };
    const input = labelerInput(multi, '');
    expect(input.columns).toHaveLength(6);
    expect(new Set(input.columns.map((column) => column.column)).size).toBe(6);
    const labels = await labelDataset({
      provider: provider(() => ({
        ...answer,
        columns: [
          { column: key(1), label: 'Первый показатель', values: [] },
          { column: key(1, 'sheet-2'), label: 'Второй показатель', values: [] },
        ],
      })),
      registryDir,
      dataset: multi,
      brief: '',
    });
    const text = datasetText(multi, labels);
    expect(text.split('Лист 2')[0]).toContain('Первый показатель');
    expect(text.split('Лист 2')[0]).not.toContain('Второй показатель');
    expect(text.split('Лист 2')[1]).toContain('Второй показатель');
    expect(text.split('Лист 2')[1]).not.toContain('Первый показатель');
  });

  it('never merges groups when two source codes receive the same caption', () => {
    const labels = {
      ...answer,
      columns: [
        {
          column: key(2),
          label: 'Исход',
          values: [
            { value: '0', label: 'Одинаково' },
            { value: '1', label: 'Одинаково' },
          ],
        },
      ],
    };
    const text = datasetText(dataset, labels);
    expect(text).toContain('Одинаково (0) — 2, Одинаково (1) — 4');
    expect(text).toContain('Одинаково (0) — 85, Одинаково (1) — 20');
  });

  it('carries explicit percentage units through labelled series into a grounded chart', async () => {
    const percent = structuredClone(dataset);
    for (const row of percent.sheets[0]?.rows ?? []) {
      const cell = row.cells[1];
      if (cell) cell.unit = '%';
    }
    const labels = await labelDataset({
      provider: provider(() => answer),
      registryDir,
      dataset: percent,
      brief,
    });
    const text = datasetText(percent, labels);
    expect(text).toContain('Облачность, среднее: Неудача — 85%, Успех — 20%.');
    const chart = plannedSeriesChart('Облачность 85% против 20%', text, 'chart');
    expect(chart).toMatchObject({
      yTitle: '%',
      categories: ['Неудача', 'Успех'],
      series: [{ values: [85, 20] }],
    });
    expect(verifyVisual(chart, text, [percent])).toEqual(chart);
    if (chart?.kind === 'chart') {
      chart.yTitle = 'млн ₽';
      expect(verifyVisual(chart, text, [percent])).toBeNull();
    }
  });

  it('preserves cancellation instead of treating Stop as a labeler failure', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Stop', 'AbortError'));
    await expect(
      labelDataset({
        provider: provider(() => answer),
        registryDir,
        dataset,
        brief,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('keeps the file names when the model does not answer', async () => {
    const labels = await labelDataset({
      provider: provider(() => {
        throw new Error('Model API HTTP 503');
      }),
      registryDir,
      dataset,
      brief: '',
    });
    expect(labels).toBeNull();
    expect(datasetText(dataset, labels)).toBe(datasetText(dataset));
    expect(datasetText(dataset)).toContain('- строк: 0 — 2, 1 — 4.');
  });
});
