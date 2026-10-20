import { describe, expect, it } from 'vitest';
import { datasetSchema, type SlotVisual } from '@lct/contracts';
import { boundedDatasetEvidence, datasetTableEvidence } from './dataset-evidence.js';
import { groundedVisual } from './workflow.js';

const dataset = datasetSchema.parse({
  datasetId: 'source',
  status: 'ok',
  source: {
    fileName: 'table.csv',
    mediaType: 'text/csv',
    bytes: 30,
    sha256: 'a'.repeat(64),
  },
  diagnostics: [],
  sheets: [
    {
      sheetId: 's1',
      name: 's1',
      index: 0,
      headerRow: 1,
      range: 'A1:B4',
      columns: [
        { columnId: 'a', index: 1, ref: 'A', header: 'Месяц', kind: 'text' },
        { columnId: 'b', index: 2, ref: 'B', header: 'Выручка', kind: 'number' },
      ],
      rows: [0, -10, null].map((value, i) => ({
        row: i + 2,
        cells: [
          {
            ref: `A${i + 2}`,
            raw: ['Январь', 'Февраль', 'Март'][i],
            kind: 'text',
            value: ['Январь', 'Февраль', 'Март'][i],
          },
          {
            ref: `B${i + 2}`,
            raw: value === null ? null : String(value),
            value,
            kind: value === null ? 'empty' : 'number',
          },
        ],
      })),
    },
  ],
});
const headers = ['Месяц', 'Выручка'];
const rows = [
  ['Январь', '0'],
  ['Февраль', '-10'],
];
const table = (): Extract<SlotVisual, { kind: 'table' }> => ({
  kind: 'table',
  slotId: 'body',
  headers,
  rows: structuredClone(rows),
});
const markdown =
  '| Месяц | Выручка |\n| --- | --- |\n| Январь | 0 |\n| Февраль | -10 |\n| Март | |';
const native = (quote: string): Extract<SlotVisual, { kind: 'native' }> => ({
  kind: 'native',
  slotId: 'body',
  block: {
    kind: 'table',
    columns: headers.map((header) => ({ header, kind: 'text' })),
    rows: [...rows, ['Март', '']].map((row) => ({
      cells: row.map((text) => ({ text, missing: text === '' })),
    })),
    sources: [{ itemId: 'brief', quote, status: 'grounded' }],
    notes: '',
  },
});
describe('complete table evidence', () => {
  it('uses nonempty null evidence for blank CSV cells while retaining the original raw', () => {
    const csv = structuredClone(dataset);
    const cell = csv.sheets[0]?.rows[2]?.cells[1];
    if (!cell) throw new Error('cell fixture');
    cell.raw = '';
    const cells = datasetTableEvidence([csv]).flatMap((sheet) =>
      sheet.rows.flatMap((row) => row.cells),
    );
    expect(cells).toContainEqual(expect.objectContaining({ ref: 'B4', raw: '', quote: 'null' }));
    const visual = native(markdown);
    if (visual.block.kind !== 'table') throw new Error('table fixture');
    visual.block.sources = cells.map((source) => ({
      itemId: source.itemId,
      quote: source.quote,
      status: 'grounded',
    }));
    expect(groundedVisual(visual, '', [csv])).toEqual(visual);
  });
  it.each([markdown, 'Месяц\tВыручка\nЯнварь\t0\nФевраль\t-10'])(
    'supports explicit text tables',
    (brief) => {
      expect(groundedVisual(table(), brief)).toEqual(table());
    },
  );
  it('preserves native missing and zero from a quoted Markdown table', () => {
    expect(groundedVisual(native(markdown), markdown)).toEqual(native(markdown));
    expect(groundedVisual(native(markdown), 'Other material')).toBeNull();
  });
  it.each(['values', 'header', 'quote'])('rejects table %s substitution', (change) => {
    const visual = native(markdown);
    if (visual.block.kind !== 'table') throw new Error('table fixture');
    if (change === 'values') visual.block.rows.reverse();
    // Reordering intact rows is valid; swapping their measured cells is not.
    if (change === 'values') {
      const first = visual.block.rows[1]?.cells[1];
      const second = visual.block.rows[2]?.cells[1];
      if (!first || !second) throw new Error('cells fixture');
      [first.text, second.text] = [second.text, first.text];
    }
    if (change === 'header') {
      const column = visual.block.columns[1];
      if (!column) throw new Error('column fixture');
      column.header = 'Затраты';
    }
    if (change === 'quote')
      visual.block.sources = [{ itemId: 'brief', quote: 'Рост продаж', status: 'grounded' }];
    expect(groundedVisual(visual, `${markdown}\n\nРост продаж`)).toBeNull();
  });
  it('withholds unstructured text instead of treating its numbers as a table', () => {
    expect(groundedVisual(table(), 'Январь и февраль, 0 и -10, выручка')).toBeNull();
  });
  it('offers textual cell addresses and null quotes, then verifies native dataset tables', () => {
    const catalog = datasetTableEvidence([dataset]);
    const cells = catalog.flatMap((sheet) => sheet.rows.flatMap((row) => row.cells));
    expect(cells).toContainEqual(
      expect.objectContaining({ itemId: 'dataset/source/s1/A2', quote: 'Январь' }),
    );
    expect(cells).toContainEqual(
      expect.objectContaining({ itemId: 'dataset/source/s1/B4', quote: 'null' }),
    );
    const visual = native(markdown);
    if (visual.block.kind !== 'table') throw new Error('fixture');
    visual.block.sources = cells.map((cell) => ({
      itemId: cell.itemId,
      quote: cell.quote,
      status: 'grounded',
    }));
    expect(groundedVisual(visual, '', [dataset])).toEqual(visual);
    visual.block.sources = visual.block.sources.filter((source) => !source.itemId.endsWith('/A2'));
    expect(groundedVisual(visual, '', [dataset])).toBeNull();
  });
  it('bounds evidence by complete sheets and explains omissions without raw dataset prompts', () => {
    const accepted = boundedDatasetEvidence([dataset]);
    expect(accepted.facts).toHaveLength(3);
    expect(accepted.tables[0]?.rows).toHaveLength(3);
    expect(boundedDatasetEvidence([dataset], { maxCells: 4, maxChars: 10000 })).toMatchObject({
      datasets: [],
      facts: [],
      tables: [],
      withheld: [{ datasetId: 'source', sheetId: 's1', reason: 'evidence-budget-exceeded' }],
    });
    expect(boundedDatasetEvidence([dataset], { maxCells: 100, maxChars: 100 })).toMatchObject({
      tables: [],
      facts: [],
    });
  });
});
