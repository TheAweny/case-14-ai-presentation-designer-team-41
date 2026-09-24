'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ColorRole, ColorValue, DesignSystem, SlideElement } from '@lct/contracts';
import { boxStyle, paint, TableColumns, tableView, type SlideSize } from '@lct/slide-renderer';
import { clearActiveTable, setActiveTable } from '@/components/editor/active-table';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  bodyRowsOf,
  cellText,
  clampCell,
  clearedCells,
  columnInsertion,
  directionOf,
  hasOwnLook,
  inRange,
  leavesCell,
  rangeOf,
  rangeToTsv,
  rowInsertion,
  sameCell,
  stepCell,
  tabTarget,
  toggledFlag,
  tsvToCells,
  type CaretEdges,
  type GridCell,
  type StyleFlag,
} from '@/components/editor/table-grid';
import type { TableOps } from '@/components/editor/use-table-ops';
import { editorCommand } from '@/components/editor/editor-keymap';

export { tableCellOf, type GridCell } from '@/components/editor/table-grid';

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** С чего начинается правка: ячейка, точка щелчка для каретки или выделить весь текст ячейки. */
export interface TableEntry {
  readonly focus: GridCell;
  readonly point?: { readonly x: number; readonly y: number } | null;
  readonly selectAll?: boolean;
}

/** Куда ставить каретку в ячейке, в которую перешли. */
type Caret = 'all' | 'start' | 'end';

/** Роли палитры, которыми меню красит ячейки: фон, поверхности и акценты шаблона. */
const FILL_ROLES: readonly ColorRole[] = [
  'background',
  'surface',
  'accent',
  'accent-alt',
  'positive',
  'negative',
  'line',
  'text',
];

/** Подсветка выделенных ячеек поверх их заливки: тень внутрь не трогает фон ячейки. */
const SELECTED: CSSProperties = {
  boxShadow: 'inset 0 0 0 100vmax color-mix(in srgb, var(--canvas-selection) 18%, transparent)',
};

const FOCUS_CLASS =
  'cursor-text outline-none focus:outline-2 focus:outline-solid focus:-outline-offset-2 focus:outline-[var(--canvas-selection)]';

function hiddenSourceCss(elementId: string): string {
  return `[data-canvas-slide] [data-slide-root] > [data-element-id="${CSS.escape(elementId)}"] { visibility: hidden; }`;
}

function cellOfNode(node: Element | null): GridCell | null {
  const value = node instanceof HTMLElement ? node.dataset.cell : undefined;
  if (!value) return null;
  const [row, column] = value.split(':').map(Number);
  return row === undefined || column === undefined ? null : { row, column };
}

/** Каретка в точке экрана, если браузер умеет её найти. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function placeCaret(node: HTMLElement, caret: Caret): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  if (caret !== 'all') range.collapse(caret === 'start');
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** У какого края текста стоит каретка. Без свёрнутой каретки из ячейки не уходим. */
function caretEdges(node: HTMLElement): CaretEdges | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!node.contains(caret.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(node);
  before.setEnd(caret.startContainer, caret.startOffset);
  const after = document.createRange();
  after.selectNodeContents(node);
  after.setStart(caret.endContainer, caret.endOffset);
  const head = before.toString();
  const tail = after.toString();
  const whole = document.createRange();
  whole.selectNodeContents(node);
  const text = whole.getBoundingClientRect();
  const at = caret.getClientRects()[0] ?? null;
  const style = getComputedStyle(node);
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
  // Каретка на границе узлов бывает без прямоугольника: тогда строки считаем по переводам.
  const firstLine = at ? at.top - text.top < line / 2 : !head.includes('\n');
  const lastLine = at ? text.bottom - at.bottom < line / 2 : !tail.includes('\n');
  return {
    start: head.length === 0,
    end: tail.length === 0,
    firstLine: head.length === 0 || firstLine,
    lastLine: tail.length === 0 || lastLine,
  };
}

/**
 * Правка таблицы прямо на слайде. Разметка та же, что у рендерера (`tableView`), и встаёт в
 * кадр слайда поверх спрятанного оригинала: таблица выглядит как до входа, только ячейки
 * принимают набор.
 *
 * Два режима, как в PowerPoint и Google Slides. Каретка в ячейке: набор, Shift+Enter — новая
 * строка, Tab — дальше (в последней ячейке добавляет строку), стрелки у края текста — в соседнюю
 * ячейку. Выделение ячеек протяжкой, Shift+щелчком или Shift+стрелками: Delete очищает,
 * Ctrl+B/I/U, меню и панель красят весь диапазон. Esc и щелчок мимо закрывают правку; текст
 * ячейки уходит в журнал одной записью, когда из неё выходят.
 */
export function TableEditor({
  slideRoot,
  element,
  profile,
  slide,
  entry,
  finishRef,
  ops,
  onClose,
}: {
  slideRoot: HTMLElement;
  element: TableElement;
  profile: DesignSystem;
  slide: SlideSize;
  entry: TableEntry;
  finishRef?: { current: (() => void) | null };
  ops: TableOps;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const menu = useTranslations('tableMenu');
  const palette = useTranslations('selectionBar.palette');
  const rootRef = useRef<HTMLDivElement>(null);
  const view = tableView(element, profile, slide);
  const rows = view.rowCount;
  const columns = view.columnCount;
  const start = clampCell(entry.focus, rows, columns);
  const [anchor, setAnchor] = useState<GridCell>(start);
  const [head, setHead] = useState<GridCell>(start);
  /** Выделены ячейки, а не текст: фокус на сетке, каретки нет. */
  const [block, setBlock] = useState(false);
  const range = rangeOf(clampCell(anchor, rows, columns), clampCell(head, rows, columns));
  const latest = useRef({ element, ops, onClose, range });
  latest.current = { element, ops, onClose, range };
  const closed = useRef(false);
  const pending = useRef<{ cell: GridCell; caret: Caret } | null>(null);
  const drag = useRef<{ start: GridCell; pointerId: number } | null>(null);
  const elementId = element.elementId;

  const cellNode = (cell: GridCell) =>
    rootRef.current?.querySelector<HTMLElement>(`[data-cell="${cell.row}:${cell.column}"]`) ?? null;

  /** Текст ячейки в журнал, если он поменялся. */
  const commitCell = (node: HTMLElement) => {
    const cell = cellOfNode(node);
    if (!cell) return;
    const current = latest.current.element;
    const before = [current.headers, ...current.rows][cell.row]?.[cell.column];
    const text = cellText(node.innerText ?? '');
    if (before === undefined || before === text) return;
    latest.current.ops.setTexts(current.elementId, [{ ...cell, text }]);
  };

  const commitActive = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.dataset.cell && rootRef.current?.contains(active)) {
      commitCell(active);
    }
  };

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    commitActive();
    latest.current.onClose();
  };
  const finishLatest = useRef(finish);
  finishLatest.current = finish;

  useEffect(() => {
    if (!finishRef) return;
    const close = () => finishLatest.current();
    finishRef.current = close;
    return () => {
      if (finishRef.current === close) finishRef.current = null;
    };
  }, [finishRef]);

  // Панель красит выделенное: диапазон виден ей, пока открыта правка.
  useEffect(() => {
    setActiveTable({ elementId, range });
  });
  useEffect(() => () => clearActiveTable(elementId), [elementId]);

  // Каретка — в ячейку, по которой щёлкнули, в точку щелчка или в конец текста.
  useLayoutEffect(() => {
    const node = cellNode(start);
    if (!node) return;
    node.focus({ preventScroll: true });
    if (entry.selectAll) {
      placeCaret(node, 'all');
      return;
    }
    const point = entry.point ? caretAt(entry.point.x, entry.point.y) : null;
    if (point && node.contains(point.node)) {
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    placeCaret(node, 'end');
    // Только при открытии: дальше каретку ведёт человек.
  }, []);

  // Текст ячеек меняется и снаружи: отмена, вставка строки выше. Ячейку с кареткой не трогаем.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const node of root.querySelectorAll<HTMLElement>('[data-cell]')) {
      if (node === document.activeElement) continue;
      const cell = cellOfNode(node);
      if (!cell) continue;
      const text = view.text(cell.row, cell.column);
      if (cellText(node.innerText ?? '') !== text) node.textContent = text;
    }
    // Переход, который ждал новую строку (Tab в последней ячейке).
    const next = pending.current;
    if (next) {
      const node = cellNode(next.cell);
      if (node) {
        pending.current = null;
        node.focus({ preventScroll: true });
        placeCaret(node, next.caret);
      }
    }
  });

  /** Каретка в другую ячейку: выделение схлопывается в неё. */
  const moveTo = (cell: GridCell, caret: Caret) => {
    setAnchor(cell);
    setHead(cell);
    setBlock(false);
    const node = cellNode(cell);
    if (node) {
      node.focus({ preventScroll: true });
      placeCaret(node, caret);
    } else {
      pending.current = { cell, caret };
    }
  };

  /** Выделение ячеек: текст уходит в журнал, фокус — на сетку, чтобы клавиши были её. */
  const enterBlock = (from: GridCell, to: GridCell) => {
    commitActive();
    setAnchor(from);
    setHead(to);
    setBlock(true);
    window.getSelection()?.removeAllRanges();
    rootRef.current?.focus({ preventScroll: true });
  };

  const appendRow = () => {
    const current = latest.current.element;
    commitActive();
    const cell = { row: current.rows.length + 1, column: 0 };
    setAnchor(cell);
    setHead(cell);
    setBlock(false);
    pending.current = { cell, caret: 'all' };
    ops.insertRows(elementId, current.rows.length, current.rows.length - 1);
  };

  const toggle = (flag: StyleFlag) => {
    const current = latest.current;
    ops.style(elementId, current.range, {
      style: { [flag]: toggledFlag(current.element, current.range, flag) },
    });
  };

  const selectAllCells = () =>
    enterBlock({ row: 0, column: 0 }, { row: rows - 1, column: columns - 1 });

  const onCellKey = (event: ReactKeyboardEvent<HTMLElement>, node: HTMLElement, cell: GridCell) => {
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Tab' && !mod && !event.altKey) {
      handled();
      const target = tabTarget(cell, rows, columns, event.shiftKey);
      if (target === 'append') appendRow();
      else if (target) {
        commitCell(node);
        moveTo(target, 'all');
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !mod && !event.altKey) {
      handled();
      commitCell(node);
      const below = stepCell(cell, 'down', rows, columns, false);
      if (below) moveTo(below, 'end');
      else finish();
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyA') {
      const text = cellText(node.innerText ?? '');
      const selected = window.getSelection()?.toString() ?? '';
      // Второй Ctrl+A, когда текст ячейки уже выделен, выделяет всю таблицу.
      if (text === '' || selected === text) {
        handled();
        selectAllCells();
      }
      return;
    }
    const direction = directionOf(event.key);
    if (!direction || mod || event.altKey) return;
    const edges = caretEdges(node);
    if (!edges || !leavesCell(direction, edges)) return;
    if (event.shiftKey) {
      const to = stepCell(cell, direction, rows, columns, false);
      if (!to) return;
      handled();
      enterBlock(cell, to);
      return;
    }
    const horizontal = direction === 'left' || direction === 'right';
    const target = stepCell(cell, direction, rows, columns, horizontal);
    if (!target) return;
    handled();
    commitCell(node);
    moveTo(target, direction === 'left' || direction === 'up' ? 'end' : 'start');
  };

  const onBlockKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    // Сочетания с Ctrl/Cmd — отмена, зум — остаются редактору.
    if (mod && event.code !== 'KeyA') return;
    event.stopPropagation();
    if (mod) {
      event.preventDefault();
      selectAllCells();
      return;
    }
    const direction = directionOf(event.key);
    if (direction) {
      event.preventDefault();
      const to = stepCell(head, direction, rows, columns, false) ?? head;
      if (event.shiftKey) setHead(to);
      else moveTo(to, 'all');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const target = tabTarget(head, rows, columns, event.shiftKey);
      if (target === 'append') appendRow();
      else if (target) moveTo(target, 'all');
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      moveTo(head, 'end');
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      ops.setTexts(elementId, clearedCells(range));
      return;
    }
    // Буква при выделенных ячейках начинает новый текст в первой из них, как в таблицах.
    if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      const cell = { row: range.top, column: range.left };
      const node = cellNode(cell);
      if (!node) return;
      setAnchor(cell);
      setHead(cell);
      setBlock(false);
      node.textContent = event.key;
      node.focus({ preventScroll: true });
      placeCaret(node, 'end');
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish();
      return;
    }
    // Начертание и выравнивание — по общему реестру сочетаний, для всех выделенных ячеек.
    const command = mod ? editorCommand(event, 'text') : null;
    if (command?.kind === 'text-flag' || command?.kind === 'text-align') {
      event.preventDefault();
      event.stopPropagation();
      if (command.kind === 'text-flag') toggle(command.flag);
      else ops.style(elementId, range, { style: { align: command.align } });
      return;
    }
    const target = event.target;
    const cell = target instanceof HTMLElement ? cellOfNode(target) : null;
    if (cell && target instanceof HTMLElement && target === document.activeElement) {
      onCellKey(event, target, cell);
      return;
    }
    if (target === rootRef.current) onBlockKey(event);
  };

  // Буфер при выделенных ячейках: колонки через Tab, строки через перевод строки.
  const onCopy = (event: ReactClipboardEvent<HTMLDivElement>, cut: boolean) => {
    if (event.target !== rootRef.current || !block) return;
    event.preventDefault();
    event.stopPropagation();
    event.clipboardData.setData('text/plain', rangeToTsv(element, range));
    if (cut) ops.setTexts(elementId, clearedCells(range));
  };

  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    const target = event.target instanceof HTMLElement ? event.target : null;
    const at = block ? { row: range.top, column: range.left } : cellOfNode(target);
    // Одна строка без табуляций — обычная вставка в текст ячейки.
    if (!at || (!block && !text.includes('\t'))) return;
    event.preventDefault();
    event.stopPropagation();
    ops.setTexts(elementId, tsvToCells(text, at, rows, columns));
  };

  const cellUnder = (x: number, y: number): GridCell | null => {
    const hit = document.elementFromPoint(x, y)?.closest('[data-cell]') ?? null;
    return hit && rootRef.current?.contains(hit) ? cellOfNode(hit) : null;
  };

  const onCellPointerDown = (event: ReactPointerEvent<HTMLElement>, cell: GridCell) => {
    if (event.button === 2) {
      // Меню — для выделенного; щелчок правой мимо выделения выделяет эту ячейку.
      if (!inRange(range, cell)) enterBlock(cell, cell);
      return;
    }
    if (event.button !== 0) return;
    if (event.shiftKey) {
      event.preventDefault();
      enterBlock(anchor, cell);
      return;
    }
    setAnchor(cell);
    setHead(cell);
    setBlock(false);
    drag.current = { start: cell, pointerId: event.pointerId };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId || (event.buttons & 1) === 0) return;
    const cell = cellUnder(event.clientX, event.clientY);
    if (!cell || (sameCell(cell, current.start) && !block)) return;
    if (!block) enterBlock(current.start, cell);
    else if (!sameCell(cell, head)) setHead(cell);
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    const release = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const bodyRows = bodyRowsOf(range);
  const columnCount = range.right - range.left + 1;
  const act = (run: () => void) => () => {
    run();
    window.setTimeout(() => rootRef.current?.focus({ preventScroll: true }), 0);
  };
  const insertRows = (where: 'above' | 'below') => {
    const { index, source, count } = rowInsertion(range, where);
    ops.insertRows(elementId, index, source, count);
    if (where === 'above' && range.top > 0) {
      setAnchor({ row: range.top + count, column: range.left });
      setHead({ row: range.bottom + count, column: range.right });
    }
  };
  const insertColumns = (where: 'left' | 'right') => {
    const { index, source, count } = columnInsertion(range, where);
    ops.insertColumns(elementId, index, source, count);
    if (where === 'left') {
      setAnchor({ row: range.top, column: range.left + count });
      setHead({ row: range.bottom, column: range.right + count });
    }
  };
  const fill = (value: ColorValue | null) =>
    ops.style(elementId, range, { style: { fill: value } });

  return createPortal(
    <>
      <style>{hiddenSourceCss(elementId)}</style>
      <div
        ref={rootRef}
        data-table-editor=""
        role="grid"
        aria-label={t('editTable')}
        aria-multiselectable
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onCopy={(event) => onCopy(event, false)}
        onCut={(event) => onCopy(event, true)}
        onPaste={onPaste}
        onPointerMove={onPointerMove}
        className="outline-none"
        style={{
          ...boxStyle(element.box, slide),
          zIndex: 2,
          overflow: 'visible',
          ...(block ? { userSelect: 'none' } : null),
        }}
      >
        <ContextMenu modal={false}>
          <ContextMenuTrigger asChild>
            <table style={view.table}>
              <TableColumns view={view} />
              <tbody>
                {Array.from({ length: rows }, (_, row) => (
                  <tr
                    key={row}
                    role="row"
                    style={view.rows[row] ? { height: view.rows[row] } : undefined}
                  >
                    {Array.from({ length: columns }, (_, column) => {
                      const cell = { row, column };
                      const selected = block && inRange(range, cell);
                      return (
                        <td
                          key={column}
                          data-cell={`${row}:${column}`}
                          role="gridcell"
                          aria-selected={selected}
                          aria-label={t('tableCell', { row: row + 1, column: column + 1 })}
                          contentEditable="plaintext-only"
                          suppressContentEditableWarning
                          // Текст ставится один раз: дальше ячейкой владеет браузер, иначе React
                          // сбрасывал бы каретку на каждом рендере. Чужие правки подтягивает
                          // эффект выше.
                          ref={(node) => {
                            if (node && node.dataset.ready !== 'true') {
                              node.textContent = view.text(row, column);
                              node.dataset.ready = 'true';
                            }
                          }}
                          onBlur={(event) => commitCell(event.currentTarget)}
                          onFocus={() => {
                            if (block) return;
                            setAnchor(cell);
                            setHead(cell);
                          }}
                          onPointerDown={(event) => onCellPointerDown(event, cell)}
                          className={FOCUS_CLASS}
                          style={{ ...view.cell(row, column), ...(selected ? SELECTED : null) }}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ContextMenuTrigger>
          <ContextMenuContent
            data-table-editor=""
            className="min-w-56"
            onCloseAutoFocus={(event) => {
              // После пункта меню клавиши снова у выделенных ячеек.
              event.preventDefault();
              setBlock(true);
              rootRef.current?.focus({ preventScroll: true });
            }}
          >
            <ContextMenuItem onSelect={act(() => insertRows('above'))}>
              {menu('insertRowAbove')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={act(() => insertRows('below'))}>
              {menu('insertRowBelow')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={act(() => insertColumns('left'))}>
              {menu('insertColumnLeft')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={act(() => insertColumns('right'))}>
              {menu('insertColumnRight')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              disabled={!bodyRows || bodyRows.count >= element.rows.length}
              onSelect={act(() => {
                if (!bodyRows) return;
                ops.removeRows(elementId, bodyRows.index, bodyRows.count);
                setAnchor({ row: Math.max(range.top, 1) - 1, column: range.left });
                setHead({ row: Math.max(range.top, 1) - 1, column: range.right });
              })}
            >
              {menu('removeRows', { count: bodyRows?.count ?? 1 })}
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              disabled={columnCount >= columns}
              onSelect={act(() => {
                ops.removeColumns(elementId, range.left, columnCount);
                setAnchor({ row: range.top, column: Math.max(range.left - 1, 0) });
                setHead({ row: range.bottom, column: Math.max(range.left - 1, 0) });
              })}
            >
              {menu('removeColumns', { count: columnCount })}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={act(() => ops.setTexts(elementId, clearedCells(range)))}>
              {menu('clearCells')}
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!hasOwnLook(element, range)}
              onSelect={act(() =>
                ops.style(elementId, range, {
                  reset: ['fill', 'color', 'bold', 'italic', 'underline', 'align', 'verticalAlign'],
                }),
              )}
            >
              {menu('resetLook')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <p className="px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground">{menu('fill')}</p>
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {FILL_ROLES.filter((role) =>
                profile.palette.some((entry) => entry.role === role),
              ).map((role) => (
                <ContextMenuItem
                  key={role}
                  aria-label={palette(role)}
                  title={palette(role)}
                  onSelect={act(() => fill(role))}
                  className="size-6 min-h-0 justify-center rounded-md p-0 ring-1 ring-border"
                  style={{ background: paint(profile.palette, role) }}
                />
              ))}
              <ContextMenuItem
                aria-label={menu('noFill')}
                title={menu('noFill')}
                onSelect={act(() => fill(null))}
                className="size-6 min-h-0 justify-center rounded-md p-0 ring-1 ring-border"
                style={{
                  background:
                    'linear-gradient(to top right, transparent 45%, var(--destructive) 45% 55%, transparent 55%)',
                }}
              />
            </div>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </>,
    slideRoot,
  );
}
