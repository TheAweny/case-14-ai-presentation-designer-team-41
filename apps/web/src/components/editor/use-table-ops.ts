'use client';

import { useMemo } from 'react';
import {
  commitDistributeTable,
  commitElementProps,
  commitInsertTableColumn,
  commitInsertTableRow,
  commitRemoveTableColumn,
  commitRemoveTableRow,
  commitTableCellStyle,
  commitTableColumnWidth,
  commitTableFitRows,
  commitTableRowHeight,
  commitTableTexts,
  type ElementProps,
  type GridText,
  type TableCellStyleChange,
  type TableRange,
} from '@lct/deck-ops';
import type { SlideIr } from '@lct/contracts';
import type { Commit, EditMode } from '@/components/editor/use-deck-history';

/**
 * Всё, что редактор делает с таблицей: текст ячеек, строки и столбцы, размеры и вид. Каждый
 * вызов — одна запись журнала; `preview` — живой вид на время жеста (протяжка границы, пикер).
 * Строки здесь считаются по сетке редактора: 0 — заголовок; вставка и удаление строк — по
 * строкам данных, как в `@lct/deck-ops`.
 */
export interface TableOps {
  /**
   * Текст ячеек. `measuredEmu` — строки как нарисованы после набора: если текст перерос рамку,
   * она растёт вместе с ним в той же записи журнала.
   */
  setTexts(elementId: string, cells: readonly GridText[], measuredEmu?: readonly number[]): void;
  insertRows(elementId: string, index: number, source: number, count?: number): void;
  removeRows(elementId: string, index: number, count?: number): void;
  insertColumns(elementId: string, index: number, source: number, count?: number): void;
  removeColumns(elementId: string, index: number, count?: number): void;
  style(elementId: string, range: TableRange, change: TableCellStyleChange, mode?: EditMode): void;
  columnWidth(elementId: string, column: number, widthEmu: number, mode?: EditMode): void;
  rowHeight(
    elementId: string,
    row: number,
    heightEmu: number,
    measuredEmu?: readonly number[],
    mode?: EditMode,
  ): void;
  distribute(elementId: string, axis: 'columns' | 'rows', measuredEmu?: readonly number[]): void;
  /** Строка заголовка, чередование, линии: свойства таблицы целиком. */
  props(elementId: string, props: ElementProps, mode?: EditMode): void;
  endPreview(): void;
}

export function useTableOps(
  run: (commits: readonly Commit[], mode?: EditMode) => void,
  endPreview: () => void,
  slideId: string | undefined,
): TableOps {
  return useMemo<TableOps>(() => {
    const one = (commit: Commit, mode?: EditMode) => {
      if (slideId) run([commit], mode);
    };
    const at = (elementId: string) => ({ slideId: slideId ?? '', elementId });
    return {
      setTexts: (elementId, cells, measuredEmu) => {
        if (!slideId) return;
        run([
          (slides) => commitTableTexts(slides, { ...at(elementId), cells }),
          ...(measuredEmu
            ? [
                (slides: readonly SlideIr[]) =>
                  commitTableFitRows(slides, { ...at(elementId), measuredEmu }),
              ]
            : []),
        ]);
      },
      insertRows: (elementId, index, source, count) =>
        one((slides) => commitInsertTableRow(slides, { ...at(elementId), index, source, count })),
      removeRows: (elementId, index, count) =>
        one((slides) => commitRemoveTableRow(slides, { ...at(elementId), index, count })),
      insertColumns: (elementId, index, source, count) =>
        one((slides) =>
          commitInsertTableColumn(slides, { ...at(elementId), index, source, count }),
        ),
      removeColumns: (elementId, index, count) =>
        one((slides) => commitRemoveTableColumn(slides, { ...at(elementId), index, count })),
      style: (elementId, range, change, mode) =>
        one((slides) => commitTableCellStyle(slides, { ...at(elementId), range, ...change }), mode),
      columnWidth: (elementId, column, widthEmu, mode) =>
        one(
          (slides) => commitTableColumnWidth(slides, { ...at(elementId), column, widthEmu }),
          mode,
        ),
      rowHeight: (elementId, row, heightEmu, measuredEmu, mode) =>
        one(
          (slides) =>
            commitTableRowHeight(slides, { ...at(elementId), row, heightEmu, measuredEmu }),
          mode,
        ),
      distribute: (elementId, axis, measuredEmu) =>
        one((slides) => commitDistributeTable(slides, { ...at(elementId), axis, measuredEmu })),
      props: (elementId, props, mode) =>
        one(
          (slides) =>
            commitElementProps(slides, { slideId: slideId ?? '', elementIds: [elementId], props }),
          mode,
        ),
      endPreview,
    };
  }, [endPreview, run, slideId]);
}
