import type { Draft } from 'immer';
import {
  tableCellStyleSchema,
  type SlideElement,
  type SlideIr,
  type TableCellStyle,
} from '@lct/contracts';
import {
  commitProduced,
  elementOf,
  produceSlides,
  selectionOf,
  unchanged,
  type DeckCommit,
} from './core.js';

/*
 * Tables
 * ------
 *
 * Rows are counted two ways. The older operations take a body row, `'header'` for the header,
 * as the contract stores them. Everything newer counts grid rows: 0 is the header, 1 the first
 * body row, the same order as `rowHeights` and `cellStyles`.
 *
 * Geometry follows PowerPoint. A column border inside the table moves between its two columns
 * and the table keeps its width; the right edge widens the last column and the table with it.
 * A row border grows or shrinks its row and the table below it. A new row takes the height of
 * the row it was made from and the table grows by it; a removed row takes its height away. A new
 * column takes the width of its source column out of the others, so a table never grows past
 * the slide sideways, and a removed column gives its width back to the rest.
 */

type Table = Extract<SlideElement, { kind: 'table' }>;

/** The narrowest column and the lowest row a drag may leave, in EMU: nine points. */
export const TABLE_MIN_TRACK_EMU = 9 * 12_700;

/** A table cell by row and column. `row` is `'header'` for the header row, else a body row. */
export interface TableCell {
  readonly row: number | 'header';
  readonly column: number;
}

/** A block of cells in grid rows (0 is the header) and columns, both ends included. */
export interface TableRange {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

/** The text of one cell, by grid row. */
export interface GridText {
  readonly row: number;
  readonly column: number;
  readonly text: string;
}

/** A change of cell look: keys to set, and keys to drop so the cell inherits them again. */
export interface TableCellStyleChange {
  readonly style?: TableCellStyle;
  readonly reset?: readonly (keyof TableCellStyle)[];
}

type Target = { readonly slideId: string; readonly elementId: string };

function validIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/** One table changed by `edit`; anything else leaves the deck as it was. */
function commitTable(
  slides: readonly SlideIr[],
  target: Target,
  edit: (table: Draft<Table>) => void,
): DeckCommit {
  const element = elementOf(slides, target.slideId, target.elementId);
  if (!element || element.kind !== 'table') return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const found = elementOf(draft, target.slideId, target.elementId);
    if (found && found.kind === 'table') edit(found as Draft<Table>);
  });
  const selected = selectionOf(target.slideId, [target.elementId]);
  return commitProduced(slides, produced, target.slideId, [], {
    kind: 'table',
    before: selected,
    after: selected,
  });
}

/**
 * Shares of a track list that add up to 1: the stated ones when there is one per track, all
 * positive, else equal shares, which is what an absent list means.
 */
export function tableShares(values: readonly number[] | undefined, count: number): number[] {
  if (count <= 0) return [];
  const usable =
    values !== undefined &&
    values.length === count &&
    values.every((value) => Number.isFinite(value) && value > 0);
  if (!usable) return Array.from({ length: count }, () => 1 / count);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

/** Lengths as shares of their sum, six decimals: far below a pixel, without float dust. */
function sharesOf(lengths: readonly number[]): number[] {
  const total = lengths.reduce((sum, value) => sum + value, 0);
  return lengths.map((value) => Math.max(1e-6, Math.round((value / total) * 1e6) / 1e6));
}

/** Absent stays absent, so a table nobody resized keeps reading as the layout drew it. */
function setTracks(
  table: Draft<Table>,
  key: 'columnWidths' | 'rowHeights',
  lengths: readonly number[] | undefined,
): void {
  if (lengths === undefined) {
    if (key in table) delete table[key];
    return;
  }
  const next = sharesOf(lengths);
  if (JSON.stringify(table[key]) !== JSON.stringify(next)) table[key] = next;
}

function columnLengths(table: Table | Draft<Table>): number[] {
  return tableShares(table.columnWidths, table.headers.length).map((share) => share * table.box.cx);
}

function rowLengths(table: Table | Draft<Table>): number[] {
  return tableShares(table.rowHeights, table.rows.length + 1).map((share) => share * table.box.cy);
}

type Styles = (TableCellStyle | null)[][];

/** Cell looks as a full grid, header row first; null where a cell states nothing. */
function styleGrid(table: Table | Draft<Table>): Styles {
  const stated = table.cellStyles ?? [];
  return Array.from({ length: table.rows.length + 1 }, (_, row) =>
    Array.from({ length: table.headers.length }, (_, column) => {
      const style = stated[row]?.[column];
      // A shallow copy: a look holds only flat values, and a draft cannot be cloned.
      return style && Object.keys(style).length > 0 ? { ...style } : null;
    }),
  );
}

/** A grid that states nothing is left out, as the contract reads a missing key. */
function setStyles(table: Draft<Table>, styles: Styles | null): void {
  const empty = styles === null || styles.every((row) => row.every((style) => style === null));
  if (empty) {
    if ('cellStyles' in table) delete table.cellStyles;
    return;
  }
  if (JSON.stringify(table.cellStyles) !== JSON.stringify(styles)) table.cellStyles = styles;
}

/*
 * Words
 * -----
 */

/** The text of one cell, the header included. */
export function commitTableCell(
  slides: readonly SlideIr[],
  change: Target & { readonly cell: TableCell; readonly text: string },
): DeckCommit {
  const { row, column } = change.cell;
  return commitTable(slides, change, (table) => {
    if (row === 'header') {
      if (validIndex(column, table.headers.length) && table.headers[column] !== change.text) {
        table.headers[column] = change.text;
      }
      return;
    }
    const cells = validIndex(row, table.rows.length) ? table.rows[row] : undefined;
    if (!cells || !validIndex(column, table.headers.length)) return;
    // A short row grows to the column it is written in, so every row keeps the header's width.
    while (cells.length <= column) cells.push('');
    if (cells[column] !== change.text) cells[column] = change.text;
  });
}

/** The text of several cells, by grid row, as one entry: clearing a block of cells is one step. */
export function commitTableTexts(
  slides: readonly SlideIr[],
  change: Target & { readonly cells: readonly GridText[] },
): DeckCommit {
  return commitTable(slides, change, (table) => {
    for (const { row, column, text } of change.cells) {
      if (!validIndex(column, table.headers.length)) continue;
      if (row === 0) {
        if (table.headers[column] !== text) table.headers[column] = text;
        continue;
      }
      const cells = validIndex(row - 1, table.rows.length) ? table.rows[row - 1] : undefined;
      if (!cells) continue;
      while (cells.length <= column) cells.push('');
      if (cells[column] !== text) cells[column] = text;
    }
  });
}

/*
 * Rows and columns
 * ----------------
 */

/**
 * `count` empty body rows at `index`, from 0 (under the header) to the row count (at the end).
 * They take the height and the cell look of body row `source`: by default the row above, or the
 * first row when they go under the header. The table grows by their height.
 */
export function commitInsertTableRow(
  slides: readonly SlideIr[],
  change: Target & { readonly index: number; readonly source?: number; readonly count?: number },
): DeckCommit {
  const count = change.count ?? 1;
  return commitTable(slides, change, (table) => {
    if (!validIndex(change.index, table.rows.length + 1)) return;
    if (!Number.isInteger(count) || count < 1) return;
    const source = change.source ?? Math.max(0, change.index - 1);
    if (!validIndex(source, table.rows.length)) return;
    const heights = rowLengths(table);
    const styles = table.cellStyles ? styleGrid(table) : null;
    const height = heights[source + 1] ?? 0;
    const look = styles?.[source + 1] ?? [];
    for (let step = 0; step < count; step += 1) {
      table.rows.splice(
        change.index,
        0,
        table.headers.map(() => ''),
      );
      heights.splice(change.index + 1, 0, height);
      styles?.splice(
        change.index + 1,
        0,
        look.map((style) => (style ? { ...style } : null)),
      );
    }
    table.box.cy = Math.round(heights.reduce((sum, value) => sum + value, 0));
    setTracks(table, 'rowHeights', table.rowHeights ? heights : undefined);
    if (styles) setStyles(table, styles);
  });
}

/**
 * Remove `count` body rows from `index`. One body row always stays: a table always has a row
 * under its header. The table loses their height.
 */
export function commitRemoveTableRow(
  slides: readonly SlideIr[],
  change: Target & { readonly index: number; readonly count?: number },
): DeckCommit {
  const count = change.count ?? 1;
  return commitTable(slides, change, (table) => {
    if (!Number.isInteger(count) || count < 1) return;
    if (!validIndex(change.index, table.rows.length)) return;
    if (change.index + count > table.rows.length || table.rows.length - count < 1) return;
    const heights = rowLengths(table);
    const styles = table.cellStyles ? styleGrid(table) : null;
    table.rows.splice(change.index, count);
    heights.splice(change.index + 1, count);
    styles?.splice(change.index + 1, count);
    table.box.cy = Math.max(1, Math.round(heights.reduce((sum, value) => sum + value, 0)));
    setTracks(table, 'rowHeights', table.rowHeights ? heights : undefined);
    if (styles) setStyles(table, styles);
  });
}

/**
 * `count` empty columns at `index`, from 0 (first) to the column count (last). They take the
 * width and the cell look of column `source`, the column before by default, and the table keeps
 * its width.
 */
export function commitInsertTableColumn(
  slides: readonly SlideIr[],
  change: Target & { readonly index: number; readonly source?: number; readonly count?: number },
): DeckCommit {
  const count = change.count ?? 1;
  return commitTable(slides, change, (table) => {
    if (!validIndex(change.index, table.headers.length + 1)) return;
    if (!Number.isInteger(count) || count < 1) return;
    const source = change.source ?? Math.max(0, change.index - 1);
    if (!validIndex(source, table.headers.length)) return;
    const widths = columnLengths(table);
    const styles = table.cellStyles ? styleGrid(table) : null;
    const width = widths[source] ?? 0;
    const look = styles?.map((row) => row[source] ?? null) ?? [];
    for (let step = 0; step < count; step += 1) {
      table.headers.splice(change.index, 0, '');
      for (const cells of table.rows) cells.splice(Math.min(change.index, cells.length), 0, '');
      widths.splice(change.index, 0, width);
      for (const [index, row] of (styles ?? []).entries()) {
        const style = look[index] ?? null;
        row.splice(change.index, 0, style ? { ...style } : null);
      }
    }
    setTracks(table, 'columnWidths', table.columnWidths ? widths : undefined);
    if (styles) setStyles(table, styles);
  });
}

/** Remove `count` columns from `index`. One column always stays; the rest share its width. */
export function commitRemoveTableColumn(
  slides: readonly SlideIr[],
  change: Target & { readonly index: number; readonly count?: number },
): DeckCommit {
  const count = change.count ?? 1;
  return commitTable(slides, change, (table) => {
    if (!Number.isInteger(count) || count < 1) return;
    if (!validIndex(change.index, table.headers.length)) return;
    if (change.index + count > table.headers.length || table.headers.length - count < 1) return;
    const widths = columnLengths(table);
    const styles = table.cellStyles ? styleGrid(table) : null;
    table.headers.splice(change.index, count);
    for (const cells of table.rows) {
      if (change.index < cells.length) cells.splice(change.index, count);
    }
    widths.splice(change.index, count);
    for (const row of styles ?? []) row.splice(change.index, count);
    setTracks(table, 'columnWidths', table.columnWidths ? widths : undefined);
    if (styles) setStyles(table, styles);
  });
}

/*
 * Geometry
 * --------
 */

/**
 * Drag the right border of `column` until the column is `widthEmu` wide. Inside the table the
 * next column gives or takes the difference and the table keeps its width; the last column
 * moves the right edge of the table. No column gets narrower than `TABLE_MIN_TRACK_EMU`.
 */
export function commitTableColumnWidth(
  slides: readonly SlideIr[],
  change: Target & { readonly column: number; readonly widthEmu: number },
): DeckCommit {
  if (!Number.isFinite(change.widthEmu)) return unchanged(slides);
  return commitTable(slides, change, (table) => {
    const { column } = change;
    if (!validIndex(column, table.headers.length)) return;
    const widths = columnLengths(table);
    const own = widths[column] ?? 0;
    const last = column === widths.length - 1;
    const next = widths[column + 1] ?? 0;
    const min = Math.min(TABLE_MIN_TRACK_EMU, own);
    const upper = last
      ? Number.POSITIVE_INFINITY
      : own + next - Math.min(TABLE_MIN_TRACK_EMU, next);
    const width = Math.min(Math.max(change.widthEmu, min), upper);
    const delta = Math.round(width - own);
    if (delta === 0) return;
    widths[column] = own + delta;
    if (last) table.box.cx = Math.max(1, table.box.cx + delta);
    else widths[column + 1] = next - delta;
    setTracks(table, 'columnWidths', widths);
  });
}

/**
 * Rows as they are drawn, when the caller measured them: a row grows past its share to fit its
 * text, and a drag starts from what the person sees. Without a usable measure, the shares.
 */
function drawnRows(table: Draft<Table>, measured: readonly number[] | undefined): number[] {
  const usable =
    measured !== undefined &&
    measured.length === table.rows.length + 1 &&
    measured.every((value) => Number.isFinite(value) && value > 0);
  return usable ? [...measured] : rowLengths(table);
}

/**
 * Drag the lower border of grid row `row` until the row is `heightEmu` high, at least
 * `TABLE_MIN_TRACK_EMU`. The other rows keep their height and the table takes the sum, so it
 * grows or shrinks below the row. `measuredEmu`, the rows as drawn, header first, keeps rows
 * that grew to fit their text as tall as they look.
 */
export function commitTableRowHeight(
  slides: readonly SlideIr[],
  change: Target & {
    readonly row: number;
    readonly heightEmu: number;
    readonly measuredEmu?: readonly number[];
  },
): DeckCommit {
  if (!Number.isFinite(change.heightEmu)) return unchanged(slides);
  return commitTable(slides, change, (table) => {
    const { row } = change;
    if (!validIndex(row, table.rows.length + 1)) return;
    const heights = drawnRows(table, change.measuredEmu);
    const own = heights[row] ?? 0;
    const height = Math.round(Math.max(change.heightEmu, Math.min(TABLE_MIN_TRACK_EMU, own)));
    if (height === Math.round(own)) return;
    heights[row] = height;
    table.box.cy = Math.max(1, Math.round(heights.reduce((sum, value) => sum + value, 0)));
    setTracks(table, 'rowHeights', heights);
  });
}

/**
 * Grow the box of a table to the rows as drawn, when its text made them taller than the box:
 * PowerPoint grows the frame with the text, so the frame the editor selects and the height the
 * audit measures are those of the table people see. A table that fits is left as it is.
 */
export function commitTableFitRows(
  slides: readonly SlideIr[],
  change: Target & { readonly measuredEmu: readonly number[] },
): DeckCommit {
  const element = elementOf(slides, change.slideId, change.elementId);
  if (!element || element.kind !== 'table') return unchanged(slides);
  const { measuredEmu } = change;
  const usable =
    measuredEmu.length === element.rows.length + 1 &&
    measuredEmu.every((value) => Number.isFinite(value) && value > 0);
  if (!usable) return unchanged(slides);
  const total = Math.round(measuredEmu.reduce((sum, value) => sum + value, 0));
  if (total <= element.box.cy) return unchanged(slides);
  return commitTable(slides, change, (table) => {
    table.box.cy = total;
    setTracks(table, 'rowHeights', measuredEmu);
  });
}

/**
 * Even out the columns or the rows. Columns go back to the default, equal widths inside the box;
 * rows get equal stated heights, since rows left to themselves size to their text, and share
 * the height the table has as drawn when the caller measured it.
 */
export function commitDistributeTable(
  slides: readonly SlideIr[],
  change: Target & {
    readonly axis: 'columns' | 'rows';
    readonly measuredEmu?: readonly number[];
  },
): DeckCommit {
  return commitTable(slides, change, (table) => {
    if (change.axis === 'columns') {
      setTracks(table, 'columnWidths', undefined);
      return;
    }
    const heights = drawnRows(table, change.measuredEmu);
    const total = Math.round(heights.reduce((sum, value) => sum + value, 0));
    if (table.box.cy !== total) table.box.cy = Math.max(1, total);
    setTracks(
      table,
      'rowHeights',
      heights.map(() => total / heights.length),
    );
  });
}

/*
 * Look
 * ----
 */

/** The cells of `range` that exist, clamped to the table. */
export function rangeCells(
  range: TableRange,
  rows: number,
  columns: number,
): { row: number; column: number }[] {
  const top = Math.max(0, Math.min(range.top, range.bottom));
  const bottom = Math.min(rows - 1, Math.max(range.top, range.bottom));
  const left = Math.max(0, Math.min(range.left, range.right));
  const right = Math.min(columns - 1, Math.max(range.left, range.right));
  const cells: { row: number; column: number }[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) cells.push({ row, column });
  }
  return cells;
}

/**
 * Set or drop look keys on every cell of `range`, as one entry. A value the contract refuses
 * leaves the cell as it was.
 */
export function commitTableCellStyle(
  slides: readonly SlideIr[],
  change: Target & { readonly range: TableRange } & TableCellStyleChange,
): DeckCommit {
  const patch = change.style ?? {};
  const reset = change.reset ?? [];
  return commitTable(slides, change, (table) => {
    const styles = styleGrid(table);
    const cells = rangeCells(change.range, table.rows.length + 1, table.headers.length);
    for (const { row, column } of cells) {
      const merged: Record<string, unknown> = { ...(styles[row]?.[column] ?? {}), ...patch };
      for (const key of reset) delete merged[key];
      for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
      const parsed = tableCellStyleSchema.safeParse(merged);
      if (!parsed.success) continue;
      const cellRow = styles[row];
      if (cellRow) cellRow[column] = Object.keys(parsed.data).length > 0 ? parsed.data : null;
    }
    setStyles(table, styles);
  });
}
