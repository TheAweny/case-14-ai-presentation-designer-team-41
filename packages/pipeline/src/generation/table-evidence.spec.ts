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
  it('resolves a unique exact header anchor to a full original table and persists its evidence', () => {
    const visual = native('Месяц | Выручка');
    const brief = JSON.stringify({ userRequirements: [{ messageId: 'u', text: markdown }] });
    expect(groundedVisual(visual, brief)).toEqual(native(markdown));
    expect(
      groundedVisual(
        visual,
        JSON.stringify({
          userRequirements: [
            { messageId: 'u', text: `${markdown}\n\n${markdown.replace('-10', '90')}` },
          ],
        }),
      ),
    ).toBeNull();
    expect(groundedVisual(native('Месяц | Затраты'), brief)).toBeNull();
  });
  it('grounds original quoted user tables through nested JSON envelopes without trusting model status', () => {
    const envelope = JSON.stringify({
      brief: JSON.stringify({
        userRequirements: [{ messageId: 'user-1', text: markdown }],
        derivedModelBrief: 'Invented',
      }),
      approvedOutline: { title: 'Not a source' },
    });
    const visual = native(markdown);
    if (visual.block.kind !== 'table') throw new Error('table fixture');
    visual.block.sources[0] = { itemId: 'brief', quote: markdown, status: 'unverified' };
    const accepted = groundedVisual(visual, envelope);
    expect(accepted).toEqual(native(markdown));
    expect(visual.block.sources[0]?.status).toBe('unverified');
    expect(
      groundedVisual(
        visual,
        JSON.stringify({
          userRequirements: [{ messageId: 'u', text: 'No table' }],
          derivedModelBrief: markdown,
          approvedOutline: { title: markdown },
        }),
      ),
    ).toBeNull();
    const altered = native(markdown);
    if (altered.block.kind !== 'table') throw new Error('table fixture');
    const alteredCell = altered.block.rows[0]?.cells[1];
    if (!alteredCell) throw new Error('cell fixture');
    alteredCell.text = '999';
    expect(groundedVisual(altered, envelope)).toBeNull();
    const split = JSON.stringify({
      userRequirements: [
        { messageId: 'a', text: markdown.slice(0, 30) },
        { messageId: 'b', text: markdown.slice(30) },
      ],
    });
    expect(groundedVisual(native(markdown), split)).toBeNull();
  });

  it('grounds exact chart metric/category/unit relationships from an original user table', () => {
    const source =
      '| Месяц | Выручка, млн руб. | Расходы, млн руб. |\n| Январь | 0 | 7 |\n| Февраль | -10 | 8 |';
    const brief = JSON.stringify({ userRequirements: [{ messageId: 'u', text: source }] });
    const chart: SlotVisual = {
      kind: 'native',
      slotId: 'body',
      block: {
        kind: 'chart',
        intent: 'time-series',
        xTitle: 'Месяц',
        yTitle: 'млн руб.',
        categories: [{ label: 'Январь' }, { label: 'Февраль' }],
        series: [
          {
            name: 'Выручка',
            unit: 'млн руб.',
            values: [
              { state: 'present', literal: '0', value: 0 },
              { state: 'present', literal: '-10', value: -10 },
            ],
          },
        ],
        sources: [{ itemId: 'brief', quote: source, status: 'unverified' }],
      },
    };
    const accepted = groundedVisual(chart, brief);
    expect(accepted).not.toBeNull();
    if (chart.kind !== 'native' || chart.block.kind !== 'chart') throw new Error('chart fixture');
    const firstSeries = chart.block.series[0];
    if (!firstSeries) throw new Error('series fixture');
    firstSeries.name = 'Расходы';
    expect(groundedVisual(chart, brief)).toBeNull();
  });
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
