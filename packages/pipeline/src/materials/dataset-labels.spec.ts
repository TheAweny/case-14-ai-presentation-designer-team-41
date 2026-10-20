import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Dataset } from '@lct/contracts';
import { datasetText } from './dataset-text.js';
import { labelDataset, labelerInput } from './dataset-labels.js';
import { seriesFacts } from '../generation/visual-grounding.js';
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

const answer = {
  rowsLabel: 'Число наблюдений',
  columns: [
    { column: 'night', label: 'Ночь наблюдения', values: [] },
    { column: 'cloud_cover', label: 'Средняя облачность, %', values: [] },
    {
      column: 'result',
      label: 'Исход наблюдения',
      values: [
        { value: '0', label: 'Неудача' },
        { value: '1', label: 'Успех' },
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
    expect(input.columns.map((column) => column.column)).toEqual([
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
      brief: 'Доля успешных наблюдений',
    });
    expect(labels?.columns.map((column) => column.column)).toEqual([
      'night',
      'cloud_cover',
      'result',
    ]);
    const text = datasetText(dataset, labels);
    expect(text).toContain('Готовые ряды для графиков, точные значения по «Исход наблюдения»:');
    expect(text).toContain('- Число наблюдений: Неудача — 2, Успех — 4.');
    expect(text).toContain('- Средняя облачность, %, среднее: Неудача — 85, Успех — 20.');
    expect(text).toContain('Средняя облачность, % (cloud_cover)');
    expect(text).not.toContain('Выдумка');
    // The table itself keeps the file's names: a cell is still found by its column.
    expect(text).toContain('| night | cloud_cover | result |');
    // The chart grounding still reads every value of the labelled series.
    const facts = seriesFacts(text).filter((fact) => fact.metric.startsWith('Средняя облачность'));
    expect(facts.map((fact) => [fact.category, fact.value])).toEqual(
      expect.arrayContaining([
        ['Неудача', 85],
        ['Успех', 20],
      ]),
    );
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
