import { describe, expect, it } from 'vitest';
import { nextCell, tableCellOf } from './table-editor';

describe('table editor cells', () => {
  it('maps the first grid row to the header', () => {
    expect(tableCellOf({ row: 0, column: 2 })).toEqual({ row: 'header', column: 2 });
    expect(tableCellOf({ row: 3, column: 1 })).toEqual({ row: 2, column: 1 });
  });

  it('tabs across the row, then down, and wraps around', () => {
    expect(nextCell({ row: 0, column: 0 }, 3, 2, false)).toEqual({ row: 0, column: 1 });
    expect(nextCell({ row: 0, column: 1 }, 3, 2, false)).toEqual({ row: 1, column: 0 });
    expect(nextCell({ row: 2, column: 1 }, 3, 2, false)).toEqual({ row: 0, column: 0 });
    expect(nextCell({ row: 0, column: 0 }, 3, 2, true)).toEqual({ row: 2, column: 1 });
  });
});
