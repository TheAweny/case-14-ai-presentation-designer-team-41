import { describe, expect, it } from 'vitest';
import { slideIrSchema, type SlideElement, type SlideIr } from '@lct/contracts';
import { commitElementProps } from './element-ops.js';
import { createDeckHistory, recordChange, redoDeck, undoDeck } from './journal.js';
import {
  TABLE_MIN_TRACK_EMU,
  commitDistributeTable,
  commitInsertTableColumn,
  commitInsertTableRow,
  commitRemoveTableColumn,
  commitRemoveTableRow,
  commitTableCellStyle,
  commitTableColumnWidth,
  commitTableRowHeight,
  commitTableTexts,
  rangeCells,
  tableShares,
} from './table-ops.js';
import type { DeckCommit } from './core.js';

type Table = Extract<SlideElement, { kind: 'table' }>;

const BOX = { x: 100_000, y: 200_000, cx: 3_000_000, cy: 900_000 };

function grid(overrides: Partial<Table> = {}): Table {
  return {
    kind: 'table',
    elementId: 'grid',
    role: 'table',
    box: { ...BOX },
    sourceShapeId: null,
    headers: ['Этап', 'Где', 'Зачем'],
    rows: [
      ['Разбор', 'Python', 'Профиль'],
      ['План', 'TypeScript', 'Слайды'],
    ],
    ...overrides,
  };
}

function deck(table: Table = grid()): SlideIr[] {
  return [
    {
      schemaVersion: 1,
      slideId: 'data',
      variant: 'balanced',
      index: 0,
      patternId: 'title-and-table',
      slideCx: 12_192_000,
      slideCy: 6_858_000,
      elements: [table],
    },
  ];
}

const AT = { slideId: 'data', elementId: 'grid' } as const;

function tableOf(slides: readonly SlideIr[]): Table {
  const element = slides[0]?.elements[0];
  if (element?.kind !== 'table') throw new Error('not a table');
  return element;
}

/** Valid SlideIR, one entry, and undo brings back exactly what was there. */
function expectStep(before: readonly SlideIr[], commit: DeckCommit): Table {
  expect(commit.change).not.toBeNull();
  expect(commit.change?.kind).toBe('table');
  for (const slide of commit.slides) expect(slideIrSchema.parse(slide)).toEqual(slide);
  const history = recordChange(createDeckHistory(before), commit);
  expect(history.undo).toHaveLength(1);
  const undone = undoDeck(history);
  expect(undone.slides).toEqual(before);
  expect(redoDeck(undone).slides).toEqual(commit.slides);
  return tableOf(commit.slides);
}

function expectNothing(before: readonly SlideIr[], commit: DeckCommit): void {
  expect(commit.change).toBeNull();
  expect(commit.slides).toBe(before);
}

describe('shares', () => {
  it('reads stated shares relative to their sum and falls back to equal ones', () => {
    expect(tableShares([2, 1, 1], 3)).toEqual([0.5, 0.25, 0.25]);
    expect(tableShares(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    // One per track or none: a list that lost its step with the grid is not trusted.
    expect(tableShares([1, 2], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(tableShares([1, 0, 1], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('clamps a range to the table and accepts it in any direction', () => {
    expect(rangeCells({ top: 2, left: 1, bottom: 1, right: 0 }, 3, 3)).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 2, column: 0 },
      { row: 2, column: 1 },
    ]);
    expect(rangeCells({ top: 2, left: 2, bottom: 9, right: 9 }, 3, 3)).toEqual([
      { row: 2, column: 2 },
    ]);
  });
});

describe('column width', () => {
  it('moves an inner border between its two columns and keeps the table width', () => {
    const slides = deck();
    const table = expectStep(
      slides,
      commitTableColumnWidth(slides, { ...AT, column: 0, widthEmu: 1_500_000 }),
    );
    expect(table.box).toEqual(BOX);
    const widths = tableShares(table.columnWidths, 3).map((share) => share * BOX.cx);
    expect(widths[0]).toBeCloseTo(1_500_000, -1);
    expect(widths[1]).toBeCloseTo(500_000, -1);
    expect(widths[2]).toBeCloseTo(1_000_000, -1);
  });

  it('never squeezes the neighbour below the narrowest column', () => {
    const slides = deck();
    const table = tableOf(
      commitTableColumnWidth(slides, { ...AT, column: 1, widthEmu: 5_000_000 }).slides,
    );
    const widths = tableShares(table.columnWidths, 3).map((share) => share * BOX.cx);
    expect(widths[2]).toBeCloseTo(TABLE_MIN_TRACK_EMU, -1);
    expect(widths[1]).toBeCloseTo(2_000_000 - TABLE_MIN_TRACK_EMU, -1);
  });

  it('moves the right edge of the table with the last column', () => {
    const slides = deck();
    const table = expectStep(
      slides,
      commitTableColumnWidth(slides, { ...AT, column: 2, widthEmu: 1_600_000 }),
    );
    expect(table.box.cx).toBe(3_600_000);
    const widths = tableShares(table.columnWidths, 3).map((share) => share * table.box.cx);
    expect(widths[0]).toBeCloseTo(1_000_000, -1);
    expect(widths[2]).toBeCloseTo(1_600_000, -1);
  });

  it('leaves the deck alone when nothing moves or the column is not there', () => {
    const slides = deck();
    expectNothing(slides, commitTableColumnWidth(slides, { ...AT, column: 0, widthEmu: 1e6 }));
    expectNothing(slides, commitTableColumnWidth(slides, { ...AT, column: 3, widthEmu: 1e5 }));
    expectNothing(slides, commitTableColumnWidth(slides, { ...AT, column: 0, widthEmu: NaN }));
  });
});

describe('row height', () => {
  it('grows one row and the table below it, the rest keep their height', () => {
    const slides = deck();
    const table = expectStep(
      slides,
      commitTableRowHeight(slides, { ...AT, row: 1, heightEmu: 600_000 }),
    );
    expect(table.box.cy).toBe(1_200_000);
    expect(table.box.y).toBe(BOX.y);
    const heights = tableShares(table.rowHeights, 3).map((share) => share * table.box.cy);
    expect(heights[0]).toBeCloseTo(300_000, -1);
    expect(heights[1]).toBeCloseTo(600_000, -1);
  });

  it('starts from the rows as drawn when they were measured', () => {
    const slides = deck();
    const measuredEmu = [200_000, 500_000, 400_000];
    const table = tableOf(
      commitTableRowHeight(slides, { ...AT, row: 2, heightEmu: 300_000, measuredEmu }).slides,
    );
    expect(table.box.cy).toBe(1_000_000);
    const heights = tableShares(table.rowHeights, 3).map((share) => share * table.box.cy);
    expect(heights[0]).toBeCloseTo(200_000, -1);
    expect(heights[1]).toBeCloseTo(500_000, -1);
    expect(heights[2]).toBeCloseTo(300_000, -1);
  });

  it('keeps a row at least as high as the lowest row a drag may leave', () => {
    const slides = deck();
    const table = tableOf(commitTableRowHeight(slides, { ...AT, row: 0, heightEmu: -5 }).slides);
    const heights = tableShares(table.rowHeights, 3).map((share) => share * table.box.cy);
    expect(heights[0]).toBeCloseTo(TABLE_MIN_TRACK_EMU, -1);
  });

  it('evens rows out over the height the table is drawn at', () => {
    const slides = deck(grid({ rowHeights: [1, 2, 3] }));
    const table = expectStep(
      slides,
      commitDistributeTable(slides, {
        ...AT,
        axis: 'rows',
        measuredEmu: [300_000, 300_000, 600_000],
      }),
    );
    expect(table.box.cy).toBe(1_200_000);
    expect(table.rowHeights?.every((share) => Math.abs(share - 1 / 3) < 1e-5)).toBe(true);

    const columns = deck(grid({ columnWidths: [1, 2, 3] }));
    expect(
      expectStep(columns, commitDistributeTable(columns, { ...AT, axis: 'columns' })),
    ).not.toHaveProperty('columnWidths');
  });
});

describe('rows and columns around a cell', () => {
  const styled = grid({
    rowHeights: [1, 2, 3],
    columnWidths: [2, 1, 1],
    cellStyles: [
      [{ fill: 'accent' }, null, null],
      [null, { bold: true }, null],
      [{ fill: 'surface' }, null, { align: 'right' }],
    ],
  });

  it('inserts a row that takes the height and the look of its source and grows the table', () => {
    const slides = deck(styled);
    const table = expectStep(slides, commitInsertTableRow(slides, { ...AT, index: 1, source: 1 }));
    expect(table.rows).toEqual([
      ['Разбор', 'Python', 'Профиль'],
      ['', '', ''],
      ['План', 'TypeScript', 'Слайды'],
    ]);
    // Heights 150 000, 300 000, 450 000: the copy of the last body row adds 450 000.
    expect(table.box.cy).toBe(1_350_000);
    const heights = tableShares(table.rowHeights, 4).map((share) => share * table.box.cy);
    expect(heights.map((value) => Math.round(value / 1000))).toEqual([150, 300, 450, 450]);
    expect(table.cellStyles?.[2]).toEqual([{ fill: 'surface' }, null, { align: 'right' }]);
    expect(table.cellStyles?.[3]).toEqual([{ fill: 'surface' }, null, { align: 'right' }]);
  });

  it('inserts several rows under the header, like the first body row', () => {
    const slides = deck();
    const table = expectStep(slides, commitInsertTableRow(slides, { ...AT, index: 0, count: 2 }));
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual(['', '', '']);
    expect(table.rows[2]).toEqual(['Разбор', 'Python', 'Профиль']);
    // Equal rows stay equal, and stay unstated: the table grows by two of them.
    expect(table.box.cy).toBe(1_500_000);
    expect(table).not.toHaveProperty('rowHeights');
    expect(table).not.toHaveProperty('cellStyles');
  });

  it('removes rows with their height and their look, and keeps one body row', () => {
    const slides = deck(styled);
    const table = expectStep(slides, commitRemoveTableRow(slides, { ...AT, index: 0 }));
    expect(table.rows).toEqual([['План', 'TypeScript', 'Слайды']]);
    expect(table.box.cy).toBe(600_000);
    expect(table.cellStyles).toEqual([
      [{ fill: 'accent' }, null, null],
      [{ fill: 'surface' }, null, { align: 'right' }],
    ]);
    expectNothing(slides, commitRemoveTableRow(slides, { ...AT, index: 0, count: 2 }));
    expectNothing(slides, commitRemoveTableRow(slides, { ...AT, index: 2 }));
  });

  it('inserts a column that takes its source width out of the others', () => {
    const slides = deck(styled);
    const table = expectStep(
      slides,
      commitInsertTableColumn(slides, { ...AT, index: 1, source: 1 }),
    );
    expect(table.headers).toEqual(['Этап', '', 'Где', 'Зачем']);
    expect(table.rows[0]).toEqual(['Разбор', '', 'Python', 'Профиль']);
    expect(table.box.cx).toBe(BOX.cx);
    expect(table.columnWidths).toEqual([0.4, 0.2, 0.2, 0.2]);
    expect(table.cellStyles?.[1]).toEqual([null, { bold: true }, { bold: true }, null]);
  });

  it('removes columns and gives their width to the rest', () => {
    const slides = deck(styled);
    const table = expectStep(
      slides,
      commitRemoveTableColumn(slides, { ...AT, index: 1, count: 2 }),
    );
    expect(table.headers).toEqual(['Этап']);
    expect(table.rows).toEqual([['Разбор'], ['План']]);
    expect(table.columnWidths).toEqual([1]);
    expect(table.cellStyles).toEqual([[{ fill: 'accent' }], [null], [{ fill: 'surface' }]]);
    expectNothing(slides, commitRemoveTableColumn(slides, { ...AT, index: 0, count: 3 }));
  });

  it('puts a table back as it was after an insert and a removal', () => {
    const slides = deck(styled);
    const row = commitInsertTableRow(slides, { ...AT, index: 2 });
    const back = commitRemoveTableRow(row.slides, { ...AT, index: 2 });
    expect(tableOf(back.slides).rows).toEqual(styled.rows);
    expect(tableOf(back.slides).cellStyles).toEqual(styled.cellStyles);
    expect(tableOf(back.slides).box.cy).toBe(BOX.cy);
  });
});

describe('cell look and words', () => {
  it('styles a block of cells as one step and drops what nobody states', () => {
    const slides = deck();
    const table = expectStep(
      slides,
      commitTableCellStyle(slides, {
        ...AT,
        range: { top: 1, left: 0, bottom: 1, right: 2 },
        style: { fill: 'accent', color: 'text-on-accent', bold: true },
      }),
    );
    expect(table.cellStyles).toEqual([
      [null, null, null],
      [
        { fill: 'accent', color: 'text-on-accent', bold: true },
        { fill: 'accent', color: 'text-on-accent', bold: true },
        { fill: 'accent', color: 'text-on-accent', bold: true },
      ],
      [null, null, null],
    ]);
    const reset = commitTableCellStyle(deck(table), {
      ...AT,
      range: { top: 0, left: 0, bottom: 2, right: 2 },
      reset: ['fill', 'color', 'bold'],
    });
    expect(tableOf(reset.slides)).not.toHaveProperty('cellStyles');
  });

  it('keeps an explicit no-fill apart from an inherited fill', () => {
    const slides = deck();
    const table = tableOf(
      commitTableCellStyle(slides, {
        ...AT,
        range: { top: 0, left: 0, bottom: 0, right: 0 },
        style: { fill: null, align: 'center', verticalAlign: 'middle' },
      }).slides,
    );
    expect(table.cellStyles?.[0]?.[0]).toEqual({
      fill: null,
      align: 'center',
      verticalAlign: 'middle',
    });
  });

  it('refuses a look the contract refuses', () => {
    const slides = deck();
    expectNothing(
      slides,
      commitTableCellStyle(slides, {
        ...AT,
        range: { top: 0, left: 0, bottom: 0, right: 0 },
        style: { fill: '#FF0000' },
      }),
    );
  });

  it('writes several cells as one step, the header included', () => {
    const slides = deck();
    const table = expectStep(
      slides,
      commitTableTexts(slides, {
        ...AT,
        cells: [
          { row: 0, column: 1, text: 'Слой' },
          { row: 2, column: 2, text: '' },
          { row: 9, column: 0, text: 'мимо' },
        ],
      }),
    );
    expect(table.headers).toEqual(['Этап', 'Слой', 'Зачем']);
    expect(table.rows[1]).toEqual(['План', 'TypeScript', '']);
  });
});

describe('table look', () => {
  it('sets the header row, the bands and the rules through element props', () => {
    const slides = deck();
    const commit = commitElementProps(slides, {
      slideId: 'data',
      elementIds: ['grid'],
      props: {
        headerRow: false,
        bandedRows: true,
        bandFill: 'EEF1F6',
        borders: {
          color: 'line',
          widthEmu: 12_700.4,
          horizontal: true,
          vertical: true,
          outer: false,
        },
      },
    });
    const table = tableOf(commit.slides);
    expect(table).toMatchObject({
      headerRow: false,
      bandedRows: true,
      bandFill: 'EEF1F6',
      borders: { color: 'line', widthEmu: 12_700, horizontal: true, vertical: true, outer: false },
    });

    const merged = tableOf(
      commitElementProps(commit.slides, {
        slideId: 'data',
        elementIds: ['grid'],
        props: { headerRow: true, bandFill: null, borders: { outer: true } },
      }).slides,
    );
    expect(merged).not.toHaveProperty('headerRow');
    expect(merged).not.toHaveProperty('bandFill');
    expect(merged.borders).toMatchObject({ vertical: true, outer: true });

    const bare = tableOf(
      commitElementProps(slides, {
        slideId: 'data',
        elementIds: ['grid'],
        props: { borders: { outer: true } },
      }).slides,
    );
    // Without rules of its own a table needs whole ones: half a rule is not a rule.
    expect(bare).not.toHaveProperty('borders');
    const none = tableOf(
      commitElementProps(slides, {
        slideId: 'data',
        elementIds: ['grid'],
        props: { borders: null },
      }).slides,
    );
    expect(none.borders).toBeNull();
  });
});
