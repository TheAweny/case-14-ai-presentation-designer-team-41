'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { DesignSystem, SlideElement } from '@lct/contracts';
import type { TableCell } from '@lct/deck-ops';
import {
  boxStyle,
  cqw,
  createTypeResolver,
  emuToCqw,
  fontFamily,
  paint,
  typeRoleOf,
  type SlideSize,
} from '@lct/slide-renderer';

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** Ячейка в координатах редактора: строка 0 — заголовок, дальше строки данных. */
export interface GridCell {
  readonly row: number;
  readonly column: number;
}

export function tableCellOf(cell: GridCell): TableCell {
  return { row: cell.row === 0 ? 'header' : cell.row - 1, column: cell.column };
}

/** Соседняя ячейка по Tab: вправо, в конце строки — на следующую, после последней — в начало. */
export function nextCell(
  cell: GridCell,
  rows: number,
  columns: number,
  backwards: boolean,
): GridCell {
  const total = rows * columns;
  const flat = cell.row * columns + cell.column;
  const next = (flat + (backwards ? -1 : 1) + total) % total;
  return { row: Math.floor(next / columns), column: next % columns };
}

function hiddenSourceCss(elementId: string): string {
  return `[data-canvas-slide] [data-slide-root] > [data-element-id="${CSS.escape(elementId)}"] { visibility: hidden; }`;
}

/**
 * Правка таблицы прямо на слайде, по двойному клику. Разметка та же, что у рендерера, и
 * встаёт в кадр слайда: таблица под курсором выглядит как до двойного клика, только ячейки
 * принимают набор. Каждая ячейка уходит в журнал, когда из неё выходят.
 */
export function TableEditor({
  slideRoot,
  element,
  profile,
  slide,
  focus,
  finishRef,
  onCell,
  onClose,
}: {
  slideRoot: HTMLElement;
  element: TableElement;
  profile: DesignSystem;
  slide: SlideSize;
  /** Ячейка, по которой дважды щёлкнули. */
  focus: GridCell;
  finishRef?: { current: (() => void) | null };
  onCell: (cell: TableCell, text: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('editor');
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = [element.headers, ...element.rows];
  const columns = element.headers.length;
  const latest = useRef({ rows, onCell, onClose });
  latest.current = { rows, onCell, onClose };
  const closed = useRef(false);

  const cellNode = (cell: GridCell) =>
    rootRef.current?.querySelector<HTMLElement>(`[data-cell="${cell.row}:${cell.column}"]`) ?? null;

  /** Текст ячейки в журнал, если он поменялся. */
  const commitCell = (node: HTMLElement) => {
    const [row = 0, column = 0] = (node.dataset.cell ?? '').split(':').map(Number);
    const before = latest.current.rows[row]?.[column];
    const text = (node.innerText ?? '').replace(/\n$/, '');
    if (before === undefined || before === text) return;
    latest.current.onCell(tableCellOf({ row, column }), text);
  };

  const finish = () => {
    if (closed.current) return;
    closed.current = true;
    const active = document.activeElement;
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) commitCell(active);
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

  // Каретка — в ячейку, по которой щёлкнули, в конец текста.
  useEffect(() => {
    const node = cellNode(focus);
    if (!node) return;
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Только при открытии: дальше каретку ведёт человек.
  }, []);

  const moveTo = (cell: GridCell) => {
    const node = cellNode(cell);
    if (!node) return;
    node.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, cell: GridCell) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      moveTo(nextCell(cell, rows.length, columns, event.shiftKey));
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (cell.row + 1 < rows.length) moveTo({ row: cell.row + 1, column: cell.column });
      else finish();
    }
  };

  const type = createTypeResolver(profile, slide.cy);
  const style = profile.typeScale.find((entry) => entry.role === typeRoleOf(element.role));
  const line = paint(profile.palette, 'line', 'text');

  return createPortal(
    <>
      <style>{hiddenSourceCss(element.elementId)}</style>
      <div
        ref={rootRef}
        data-table-editor=""
        role="group"
        aria-label={t('editTable')}
        style={{ ...boxStyle(element.box, slide), zIndex: 2, overflow: 'visible' }}
      >
        <table
          style={{
            width: '100%',
            height: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
            fontFamily: fontFamily(style?.font ?? ''),
            fontSize: cqw(emuToCqw(type.sizeEmu(element.role), slide)),
            color: paint(profile.palette, style?.colorRole ?? 'text', 'text'),
            lineHeight: style?.lineSpacing ?? 1.2,
          }}
        >
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => (
                  <td
                    key={columnIndex}
                    style={{
                      padding: 0,
                      borderBottom: `1px solid ${line}`,
                      background:
                        rowIndex === 0
                          ? paint(profile.palette, 'surface', 'background')
                          : undefined,
                      fontWeight: rowIndex === 0 ? 700 : 400,
                      verticalAlign: 'top',
                    }}
                  >
                    <div
                      data-cell={`${rowIndex}:${columnIndex}`}
                      contentEditable="plaintext-only"
                      suppressContentEditableWarning
                      role="textbox"
                      aria-label={t('tableCell', { row: rowIndex + 1, column: columnIndex + 1 })}
                      // Текст ставится один раз: дальше ячейкой владеет браузер, иначе React
                      // сбросит каретку на каждом рендере.
                      ref={(node) => {
                        if (node && node.dataset.ready !== 'true') {
                          node.textContent = cell;
                          node.dataset.ready = 'true';
                        }
                      }}
                      onBlur={(event) => commitCell(event.currentTarget)}
                      onKeyDown={(event) =>
                        onKeyDown(event, { row: rowIndex, column: columnIndex })
                      }
                      className="min-h-full cursor-text outline-none focus:bg-[var(--canvas-selection)]/10 focus:ring-1 focus:ring-[var(--canvas-selection)] focus:ring-inset"
                      style={{
                        padding: '0.35em 0.5em',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'break-word',
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>,
    slideRoot,
  );
}
