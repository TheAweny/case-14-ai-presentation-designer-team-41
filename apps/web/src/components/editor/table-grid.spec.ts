import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import {
  bodyRowsOf,
  cellText,
  cellsOf,
  clampRange,
  clearedCells,
  columnInsertion,
  commonLook,
  directionOf,
  hasOwnLook,
  inRange,
  leavesCell,
  rangeOf,
  rangeToTsv,
  rowInsertion,
  stepCell,
  tabTarget,
  tableCellOf,
  toggledFlag,
  tsvToCells,
  wholeTable,
} from './table-grid';

type Table = Extract<SlideElement, { kind: 'table' }>;

const TABLE: Table = {
  kind: 'table',
  elementId: 'grid',
  role: 'table',
  box: { x: 0, y: 0, cx: 3_000_000, cy: 900_000 },
  sourceShapeId: null,
  headers: ['Этап', 'Где'],
  rows: [
    ['Разбор', 'Python'],
    ['План', 'TypeScript'],
  ],
};

describe('table grid cells', () => {
  it('maps the first grid row to the header', () => {
    expect(tableCellOf({ row: 0, column: 2 })).toEqual({ row: 'header', column: 2 });
    expect(tableCellOf({ row: 3, column: 1 })).toEqual({ row: 2, column: 1 });
  });

  it('tabs across the row, then down, and asks for a row after the last cell', () => {
    expect(tabTarget({ row: 0, column: 0 }, 3, 2, false)).toEqual({ row: 0, column: 1 });
    expect(tabTarget({ row: 0, column: 1 }, 3, 2, false)).toEqual({ row: 1, column: 0 });
    expect(tabTarget({ row: 2, column: 1 }, 3, 2, false)).toBe('append');
    expect(tabTarget({ row: 1, column: 0 }, 3, 2, true)).toEqual({ row: 0, column: 1 });
    expect(tabTarget({ row: 0, column: 0 }, 3, 2, true)).toBeNull();
  });

  it('steps with the arrows, wrapping sideways and stopping at the top and the bottom', () => {
    expect(stepCell({ row: 1, column: 0 }, 'left', 3, 2)).toEqual({ row: 0, column: 1 });
    expect(stepCell({ row: 1, column: 1 }, 'right', 3, 2)).toEqual({ row: 2, column: 0 });
    expect(stepCell({ row: 1, column: 1 }, 'right', 3, 2, false)).toBeNull();
    expect(stepCell({ row: 0, column: 1 }, 'up', 3, 2)).toBeNull();
    expect(stepCell({ row: 2, column: 1 }, 'down', 3, 2)).toBeNull();
    expect(stepCell({ row: 1, column: 1 }, 'down', 3, 2)).toEqual({ row: 2, column: 1 });
    expect(directionOf('ArrowUp')).toBe('up');
    expect(directionOf('Tab')).toBeNull();
  });

  it('leaves a cell only from the edge of its text', () => {
    const middle = { start: false, end: false, firstLine: true, lastLine: false };
    expect(leavesCell('left', middle)).toBe(false);
    expect(leavesCell('up', middle)).toBe(true);
    expect(leavesCell('down', middle)).toBe(false);
    expect(leavesCell('right', { ...middle, end: true })).toBe(true);
  });

  it('keeps a range in any drag direction and inside the table', () => {
    const range = rangeOf({ row: 2, column: 1 }, { row: 0, column: 0 });
    expect(range).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
    expect(inRange(range, { row: 1, column: 1 })).toBe(true);
    expect(inRange(range, { row: 3, column: 0 })).toBe(false);
    expect(cellsOf({ top: 1, left: 0, bottom: 1, right: 1 })).toEqual([
      { row: 1, column: 0 },
      { row: 1, column: 1 },
    ]);
    expect(clampRange({ top: 1, left: 1, bottom: 5, right: 4 }, 3, 2)).toEqual({
      top: 1,
      left: 1,
      bottom: 2,
      right: 1,
    });
    expect(wholeTable(TABLE)).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
  });
});

describe('table grid text', () => {
  it('drops the newline a browser appends to an editable node', () => {
    expect(cellText('Две\nстроки\n')).toBe('Две\nстроки');
    expect(cellText('a\r\nb')).toBe('a\nb');
  });

  it('copies a range as tab separated text and pastes it back inside the table', () => {
    const range = { top: 0, left: 0, bottom: 1, right: 1 };
    expect(rangeToTsv(TABLE, range)).toBe('Этап\tГде\nРазбор\tPython');
    expect(tsvToCells('a\tb\tc\nd\te\n', { row: 1, column: 1 }, 3, 2)).toEqual([
      { row: 1, column: 1, text: 'a' },
      { row: 2, column: 1, text: 'd' },
    ]);
    expect(clearedCells({ top: 2, left: 0, bottom: 2, right: 1 })).toEqual([
      { row: 2, column: 0, text: '' },
      { row: 2, column: 1, text: '' },
    ]);
  });
});

describe('table grid structure', () => {
  it('inserts as many rows as are selected, next to them and in their image', () => {
    const range = { top: 1, left: 0, bottom: 2, right: 1 };
    expect(rowInsertion(range, 'above')).toEqual({ index: 0, source: 0, count: 2 });
    expect(rowInsertion(range, 'below')).toEqual({ index: 2, source: 1, count: 2 });
    // The header has nothing above it: a row «above» goes under it.
    expect(rowInsertion({ top: 0, left: 0, bottom: 0, right: 0 }, 'above')).toEqual({
      index: 0,
      source: 0,
      count: 1,
    });
    expect(columnInsertion({ top: 0, left: 1, bottom: 0, right: 1 }, 'left')).toEqual({
      index: 1,
      source: 1,
      count: 1,
    });
    expect(columnInsertion({ top: 0, left: 0, bottom: 0, right: 1 }, 'right')).toEqual({
      index: 2,
      source: 1,
      count: 2,
    });
  });

  it('removes body rows only', () => {
    expect(bodyRowsOf({ top: 0, left: 0, bottom: 2, right: 0 })).toEqual({ index: 0, count: 2 });
    expect(bodyRowsOf({ top: 0, left: 0, bottom: 0, right: 0 })).toBeNull();
  });
});

describe('table grid look', () => {
  const styled: Table = {
    ...TABLE,
    cellStyles: [[null, null], [{ bold: true }, { bold: true, fill: 'accent' }], []],
  };

  it('turns a flag on unless every cell already has it', () => {
    expect(toggledFlag(styled, { top: 1, left: 0, bottom: 1, right: 1 }, 'bold')).toBe(false);
    expect(toggledFlag(styled, { top: 1, left: 0, bottom: 2, right: 1 }, 'bold')).toBe(true);
    // The header is bold by default.
    expect(toggledFlag(styled, { top: 0, left: 0, bottom: 0, right: 1 }, 'bold')).toBe(false);
  });

  it('reads one look for the range or none when the cells differ', () => {
    expect(commonLook(styled, { top: 1, left: 1, bottom: 1, right: 1 }, 'fill')).toBe('accent');
    expect(commonLook(styled, { top: 1, left: 0, bottom: 1, right: 1 }, 'fill')).toBeUndefined();
    expect(commonLook(styled, { top: 2, left: 0, bottom: 2, right: 1 }, 'fill')).toBeNull();
    expect(hasOwnLook(styled, { top: 2, left: 0, bottom: 2, right: 1 })).toBe(false);
    expect(hasOwnLook(styled, { top: 1, left: 0, bottom: 1, right: 0 })).toBe(true);
  });
});
