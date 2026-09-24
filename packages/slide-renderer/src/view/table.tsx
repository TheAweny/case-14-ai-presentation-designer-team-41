import type { CSSProperties, JSX } from 'react';
import type {
  ColorValue,
  DesignSystem,
  ParagraphAlign,
  SlideElement,
  TableBorders,
  VerticalAlign,
} from '@lct/contracts';
import { cqw, emuToCqw, percent, type SlideSize } from '../geometry.js';
import { createTypeResolver, typeRoleOf } from '../schematic/text-layout.js';
import { fontFamily, paint, resolveColor } from './color.js';
import { markHooks, markStyle } from './mark.js';

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** Space between the rule of a cell and its words, in the type size of the table. */
export const TABLE_CELL_PADDING = '0.35em 0.5em';

/**
 * The look of one cell once everything it inherits is settled: what the cell states, then the
 * header or banded row it sits in, then the table's type role. Rows count the header as 0.
 */
export interface TableCellLook {
  /** Null: no fill, the slide shows through. */
  readonly fill: ColorValue | null;
  /** Null: the colour of the table's type role. */
  readonly color: ColorValue | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly align: ParagraphAlign;
  readonly verticalAlign: VerticalAlign;
}

/** Whether grid row `row` is drawn as the header. */
export function isHeaderRow(table: Pick<TableElement, 'headerRow'>, row: number): boolean {
  return row === 0 && table.headerRow !== false;
}

/** Whether grid row `row` is tinted: every other body row, starting with the first. */
export function isBandedRow(
  table: Pick<TableElement, 'headerRow' | 'bandedRows'>,
  row: number,
): boolean {
  if (table.bandedRows !== true) return false;
  const body = table.headerRow === false ? row : row - 1;
  return body >= 0 && body % 2 === 0;
}

export function tableCellLook(
  table: Pick<TableElement, 'headerRow' | 'bandedRows' | 'bandFill' | 'cellStyles'>,
  row: number,
  column: number,
): TableCellLook {
  const own = table.cellStyles?.[row]?.[column] ?? null;
  const header = isHeaderRow(table, row);
  const inherited: ColorValue | null = header
    ? 'surface'
    : isBandedRow(table, row)
      ? (table.bandFill ?? 'surface')
      : null;
  return {
    fill: own?.fill !== undefined ? own.fill : inherited,
    color: own?.color ?? null,
    bold: own?.bold ?? header,
    italic: own?.italic ?? false,
    underline: own?.underline ?? false,
    align: own?.align ?? 'left',
    verticalAlign: own?.verticalAlign ?? 'top',
  };
}

/** A share of each track, relative to their sum; equal shares when the list does not fit. */
export function trackShares(values: readonly number[] | undefined, count: number): number[] {
  if (count <= 0) return [];
  const usable =
    values !== undefined &&
    values.length === count &&
    values.every((value) => Number.isFinite(value) && value > 0);
  if (!usable) return Array.from({ length: count }, () => 1 / count);
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
}

/** The hairline a table is ruled with when it states no rules: a sliver of the slide width. */
function hairlineEmu(size: SlideSize): number {
  return Math.max(size.cx * 0.0012, 1);
}

/**
 * The rules a table is drawn with. Absent is a hairline in the line role under every row, as
 * tables were drawn before they could say; null is no lines at all.
 */
export function tableBordersOf(
  table: Pick<TableElement, 'borders'>,
  size: SlideSize,
): TableBorders | null {
  if (table.borders === null) return null;
  return (
    table.borders ?? {
      color: 'line',
      widthEmu: hairlineEmu(size),
      horizontal: true,
      vertical: false,
      outer: false,
    }
  );
}

/**
 * Everything the markup of a table needs, for the slide and for the cell editor alike: the same
 * numbers give the same table, so the editor opens exactly over what was drawn.
 */
export interface TableView {
  readonly rowCount: number;
  readonly columnCount: number;
  /** Words of a cell, by grid row. */
  text(row: number, column: number): string;
  readonly table: CSSProperties;
  /** Width of each column as a share of the table, or null when the columns are equal. */
  readonly columns: readonly string[] | null;
  /** Height of each row, or undefined when the rows share the box by their text. */
  readonly rows: readonly (string | undefined)[];
  cell(row: number, column: number): CSSProperties;
  look(row: number, column: number): TableCellLook;
}

export function tableView(
  element: TableElement,
  profile: DesignSystem,
  size: SlideSize,
): TableView {
  const type = createTypeResolver(profile, size.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const { palette } = profile;
  const grid = [element.headers, ...element.rows];
  const rowCount = grid.length;
  const columnCount = element.headers.length;
  const borders = tableBordersOf(element, size);
  const rule = borders
    ? `${cqw(emuToCqw(borders.widthEmu, size))} solid ${resolveColor(palette, borders.color, 'line', 'text')}`
    : undefined;
  const columns = element.columnWidths
    ? trackShares(element.columnWidths, columnCount).map((share) => percent(share * 100))
    : null;
  const rows = element.rowHeights
    ? trackShares(element.rowHeights, rowCount).map((share) =>
        cqw(emuToCqw(share * element.box.cy, size)),
      )
    : grid.map(() => undefined);
  const look = (row: number, column: number) => tableCellLook(element, row, column);
  return {
    rowCount,
    columnCount,
    text: (row, column) => grid[row]?.[column] ?? '',
    table: {
      width: '100%',
      height: '100%',
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      fontFamily: fontFamily(style?.font ?? ''),
      fontSize: cqw(emuToCqw(type.sizeEmu(element.role), size)),
      color: paint(palette, style?.colorRole ?? 'text', 'text'),
      lineHeight: style?.lineSpacing ?? 1.2,
      ...(borders?.outer ? { border: rule } : null),
    },
    columns,
    rows,
    look,
    cell: (row, column) => {
      const cell = look(row, column);
      return {
        padding: TABLE_CELL_PADDING,
        ...(borders?.horizontal ? { borderBottom: rule } : null),
        ...(borders?.vertical && column < columnCount - 1 ? { borderRight: rule } : null),
        background:
          cell.fill === null
            ? undefined
            : resolveColor(palette, cell.fill, 'surface', 'background'),
        ...(cell.color === null ? null : { color: resolveColor(palette, cell.color, 'text') }),
        fontWeight: cell.bold ? 700 : 400,
        ...(cell.italic ? { fontStyle: 'italic' } : null),
        ...(cell.underline ? { textDecoration: 'underline' } : null),
        ...(cell.align === 'left' ? null : { textAlign: cell.align }),
        verticalAlign: cell.verticalAlign,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      };
    },
  };
}

/** Column widths of a table, when it states them. */
export function TableColumns({ view }: { view: TableView }): JSX.Element | null {
  if (!view.columns) return null;
  return (
    <colgroup>
      {view.columns.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

/** A table as the layout or the editor left it: header row, body rows, the look of each cell. */
export function TableMark({
  element,
  size,
  profile,
  thumbnail = false,
}: {
  element: TableElement;
  size: SlideSize;
  profile: DesignSystem;
  thumbnail?: boolean;
}): JSX.Element {
  const view = tableView(element, profile, size);
  return (
    <div
      {...markHooks(element, thumbnail)}
      style={{ ...markStyle(element, size), overflow: 'visible' }}
    >
      <table style={view.table}>
        <TableColumns view={view} />
        <tbody>
          {Array.from({ length: view.rowCount }, (_, row) => (
            <tr key={row} style={view.rows[row] ? { height: view.rows[row] } : undefined}>
              {Array.from({ length: view.columnCount }, (_, column) => (
                <td key={column} style={view.cell(row, column)}>
                  {view.text(row, column)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
