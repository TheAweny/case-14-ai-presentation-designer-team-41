import type { SlideElement, TableCellStyle } from '@lct/contracts';
import type { GridText, TableCell, TableRange } from '@lct/deck-ops';
import { tableCellLook } from '@lct/slide-renderer';

/**
 * Таблица глазами редактора: ячейки сеткой, где строка 0 — заголовок, дальше строки данных.
 * Чистые функции без DOM и React: куда ведут клавиши, что выделено, что делают пункты меню.
 */

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** Ячейка в координатах редактора: строка 0 — заголовок, дальше строки данных. */
export interface GridCell {
  readonly row: number;
  readonly column: number;
}

export function tableCellOf(cell: GridCell): TableCell {
  return { row: cell.row === 0 ? 'header' : cell.row - 1, column: cell.column };
}

export function sameCell(left: GridCell, right: GridCell): boolean {
  return left.row === right.row && left.column === right.column;
}

/** Прямоугольник между двумя углами выделения, в любом направлении протяжки. */
export function rangeOf(anchor: GridCell, head: GridCell): TableRange {
  return {
    top: Math.min(anchor.row, head.row),
    bottom: Math.max(anchor.row, head.row),
    left: Math.min(anchor.column, head.column),
    right: Math.max(anchor.column, head.column),
  };
}

export function inRange(range: TableRange, cell: GridCell): boolean {
  return (
    cell.row >= range.top &&
    cell.row <= range.bottom &&
    cell.column >= range.left &&
    cell.column <= range.right
  );
}

export function isSingleCell(range: TableRange): boolean {
  return range.top === range.bottom && range.left === range.right;
}

/** Вся таблица одним диапазоном: так панель правит таблицу, когда ячейки не выделены. */
export function wholeTable(table: Pick<TableElement, 'headers' | 'rows'>): TableRange {
  return { top: 0, left: 0, bottom: table.rows.length, right: table.headers.length - 1 };
}

/** Ячейки диапазона построчно. */
export function cellsOf(range: TableRange): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) cells.push({ row, column });
  }
  return cells;
}

/** Диапазон, урезанный до таблицы: после удаления строк выделение не висит в пустоте. */
export function clampRange(range: TableRange, rows: number, columns: number): TableRange {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(max, 0));
  return {
    top: clamp(range.top, rows - 1),
    bottom: clamp(range.bottom, rows - 1),
    left: clamp(range.left, columns - 1),
    right: clamp(range.right, columns - 1),
  };
}

export function clampCell(cell: GridCell, rows: number, columns: number): GridCell {
  return {
    row: Math.min(Math.max(cell.row, 0), rows - 1),
    column: Math.min(Math.max(cell.column, 0), columns - 1),
  };
}

/**
 * Куда ведёт Tab: вправо, в конце строки — на следующую. Tab в последней ячейке добавляет
 * строку (`append`), как в PowerPoint и Google Slides; Shift+Tab в первой никуда не ведёт.
 */
export function tabTarget(
  cell: GridCell,
  rows: number,
  columns: number,
  backwards: boolean,
): GridCell | 'append' | null {
  const flat = cell.row * columns + cell.column + (backwards ? -1 : 1);
  if (flat < 0) return null;
  if (flat >= rows * columns) return 'append';
  return { row: Math.floor(flat / columns), column: flat % columns };
}

export type GridDirection = 'up' | 'down' | 'left' | 'right';

export function directionOf(key: string): GridDirection | null {
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/**
 * Соседняя ячейка в направлении стрелки. Влево и вправо на краю строки переходят на соседнюю
 * строку, как каретка в тексте; вверх и вниз у края таблицы упираются — тогда null.
 */
export function stepCell(
  cell: GridCell,
  direction: GridDirection,
  rows: number,
  columns: number,
  wrap = true,
): GridCell | null {
  switch (direction) {
    case 'up':
      return cell.row > 0 ? { row: cell.row - 1, column: cell.column } : null;
    case 'down':
      return cell.row < rows - 1 ? { row: cell.row + 1, column: cell.column } : null;
    case 'left':
      if (cell.column > 0) return { row: cell.row, column: cell.column - 1 };
      return wrap && cell.row > 0 ? { row: cell.row - 1, column: columns - 1 } : null;
    case 'right':
      if (cell.column < columns - 1) return { row: cell.row, column: cell.column + 1 };
      return wrap && cell.row < rows - 1 ? { row: cell.row + 1, column: 0 } : null;
  }
}

/** Где каретка в тексте ячейки: у какого края она стоит. */
export interface CaretEdges {
  readonly start: boolean;
  readonly end: boolean;
  readonly firstLine: boolean;
  readonly lastLine: boolean;
}

/**
 * Стрелка уходит из ячейки, только если каретка уже у края текста в эту сторону: иначе она
 * двигает каретку внутри, как в любом тексте.
 */
export function leavesCell(direction: GridDirection, caret: CaretEdges): boolean {
  switch (direction) {
    case 'left':
      return caret.start;
    case 'right':
      return caret.end;
    case 'up':
      return caret.firstLine;
    case 'down':
      return caret.lastLine;
  }
}

/** Текст ячейки из редактируемого узла: последний перевод строки браузер добавляет сам. */
export function cellText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

/** Пустые строки для очистки диапазона: одна запись журнала на всё. */
export function clearedCells(range: TableRange): GridText[] {
  return cellsOf(range).map(({ row, column }) => ({ row, column, text: '' }));
}

/** Диапазон как текст для буфера: колонки через Tab, строки через перевод строки, как в Sheets. */
export function rangeToTsv(table: Pick<TableElement, 'headers' | 'rows'>, range: TableRange) {
  const grid = [table.headers, ...table.rows];
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const values: string[] = [];
    for (let column = range.left; column <= range.right; column += 1) {
      values.push((grid[row]?.[column] ?? '').replace(/[\t\n]+/g, ' '));
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Текст из буфера — в ячейки с угла `at`. Колонки через Tab, строки через перевод строки; что не
 * помещается в таблицу, отбрасывается: вставка не растит таблицу молча.
 */
export function tsvToCells(text: string, at: GridCell, rows: number, columns: number): GridText[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const cells: GridText[] = [];
  for (const [dy, line] of lines.entries()) {
    for (const [dx, value] of line.split('\t').entries()) {
      const row = at.row + dy;
      const column = at.column + dx;
      if (row < rows && column < columns) cells.push({ row, column, text: value });
    }
  }
  return cells;
}

/** Флаг начертания, который кнопка B/I/U ставит всем: если у всех уже стоит — снимает. */
export type StyleFlag = 'bold' | 'italic' | 'underline';

export function toggledFlag(table: TableElement, range: TableRange, flag: StyleFlag): boolean {
  return !cellsOf(range).every((cell) => tableCellLook(table, cell.row, cell.column)[flag]);
}

/** Одно значение на весь диапазон или `undefined` — «разные». */
export function commonLook<K extends keyof ReturnType<typeof tableCellLook>>(
  table: TableElement,
  range: TableRange,
  key: K,
): ReturnType<typeof tableCellLook>[K] | undefined {
  const values = cellsOf(range).map((cell) => tableCellLook(table, cell.row, cell.column)[key]);
  const [first, ...rest] = values;
  return rest.every((value) => value === first) ? first : undefined;
}

/** Строки данных внутри диапазона: заголовок не удаляется и не вставляется. */
export function bodyRowsOf(range: TableRange): { index: number; count: number } | null {
  const top = Math.max(range.top, 1);
  if (top > range.bottom) return null;
  return { index: top - 1, count: range.bottom - top + 1 };
}

/**
 * Новые строки над диапазоном или под ним: столько, сколько выделено строк, и по образцу
 * крайней. Над заголовком строк не бывает: вставка «выше» у заголовка кладёт строку под него.
 */
export function rowInsertion(
  range: TableRange,
  where: 'above' | 'below',
): { index: number; source: number; count: number } {
  const count = range.bottom - range.top + 1;
  if (where === 'above') {
    const index = Math.max(range.top - 1, 0);
    return { index, source: index, count };
  }
  const index = range.bottom;
  return { index, source: Math.max(range.bottom - 1, 0), count };
}

export function columnInsertion(
  range: TableRange,
  where: 'left' | 'right',
): { index: number; source: number; count: number } {
  const count = range.right - range.left + 1;
  return where === 'left'
    ? { index: range.left, source: range.left, count }
    : { index: range.right + 1, source: range.right, count };
}

/** Сколько ключей вида у ячеек диапазона задано явно: есть ли что сбрасывать. */
export function hasOwnLook(table: TableElement, range: TableRange): boolean {
  return cellsOf(range).some((cell) => {
    const style: TableCellStyle | null | undefined = table.cellStyles?.[cell.row]?.[cell.column];
    return style !== null && style !== undefined && Object.keys(style).length > 0;
  });
}
