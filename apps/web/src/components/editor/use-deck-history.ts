'use client';

import { useCallback, useState } from 'react';
import type { Box, ColorRole, Paragraph, SlideElement, SlideIr } from '@lct/contracts';
import {
  commitArrange,
  commitChartAxes,
  commitChartData,
  commitDuplicate,
  commitDuplicateSlide,
  commitElementProps,
  commitInsert,
  commitInsertSlide,
  commitInsertTableColumn,
  commitInsertTableRow,
  commitMoves,
  commitPaste,
  commitRemove,
  commitRemoveSlide,
  commitRemoveTableColumn,
  commitRemoveTableRow,
  commitReplaceImage,
  commitSetColor,
  commitSetFontSize,
  commitSetText,
  commitSlideBackground,
  commitTableCell,
  createDeckHistory,
  recordChange,
  redoDeck,
  reorderSlides,
  undoDeck,
  type ArrangeTarget,
  type ChartSeries,
  type DeckChange,
  type DeckSelection,
  type ElementProps,
  type Offset,
  type RecordOptions,
  type TableCell,
} from '@lct/deck-ops';

export interface ElementMove {
  readonly elementId: string;
  readonly box: Box;
}

/** What an undo or redo button would bring back, in words the tooltip can name. */
export type ChangeKind =
  | 'move'
  | 'text'
  | 'remove'
  | 'style'
  | 'rotate'
  | 'lock'
  | 'insert'
  | 'paste'
  | 'duplicate'
  | 'arrange'
  | 'image'
  | 'table'
  | 'chart'
  | 'slides'
  | 'slide-add'
  | 'slide-remove'
  | 'background'
  | 'other';

/** Имя правки для подсказки. Ключи словаря `editor.history.changes` совпадают с этим списком. */
const KIND_OF: Readonly<Record<DeckChange['kind'], ChangeKind>> = {
  move: 'move',
  text: 'text',
  'font-size': 'style',
  color: 'style',
  style: 'style',
  rotate: 'rotate',
  lock: 'lock',
  remove: 'remove',
  insert: 'insert',
  paste: 'paste',
  duplicate: 'duplicate',
  arrange: 'arrange',
  image: 'image',
  table: 'table',
  chart: 'chart',
  'slide-order': 'slides',
  'slide-insert': 'slide-add',
  'slide-duplicate': 'slide-add',
  'slide-remove': 'slide-remove',
  'slide-background': 'background',
};

export function changeKind(change: DeckChange | undefined): ChangeKind | null {
  if (!change) return null;
  return KIND_OF[change.kind] ?? 'other';
}

/**
 * Колода, которую показывает редактор, плюс один шаг отмены на жест. Исходные слайды остаются
 * на месте: журнал сбрасывается, только когда меняется сам список слайдов колоды.
 */
export function useDeckHistory(slides: readonly SlideIr[]) {
  const [history, setHistory] = useState(() => createDeckHistory(slides));
  const signature = slides.map((slide) => slide.slideId).join('\0');
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setHistory(createDeckHistory(slides));
  }

  /** Одна правка — одна запись журнала. Всё, что ниже, отличается только тем, что коммитит. */
  const apply = useCallback(
    (
      commit: (current: readonly SlideIr[]) => ReturnType<typeof commitMoves>,
      options?: RecordOptions,
    ) => {
      setHistory((current) => recordChange(current, commit(current.slides), options));
    },
    [],
  );

  const move = useCallback(
    (slideId: string, moves: readonly ElementMove[]) => {
      apply((current) => commitMoves(current, { slideId, moves }));
    },
    [apply],
  );
  const setText = useCallback(
    (
      slideId: string,
      elementId: string,
      paragraphs: readonly Paragraph[],
      options?: RecordOptions,
    ) => {
      apply((current) => commitSetText(current, { slideId, elementId, paragraphs }), options);
    },
    [apply],
  );
  const remove = useCallback(
    (slideId: string, elementIds: readonly string[]) => {
      apply((current) => commitRemove(current, { slideId, elementIds }));
    },
    [apply],
  );
  const reorder = useCallback(
    (from: number, to: number) => {
      apply((current) => reorderSlides(current, from, to));
    },
    [apply],
  );
  const insert = useCallback(
    (slideId: string, elements: readonly SlideElement[]) => {
      apply((current) => commitInsert(current, { slideId, elements }));
    },
    [apply],
  );
  const setFontSize = useCallback(
    (slideId: string, elementId: string, sizePt: number) => {
      apply((current) => commitSetFontSize(current, { slideId, elementId, sizePt }));
    },
    [apply],
  );
  const setColor = useCallback(
    (slideId: string, elementId: string, colorRole: ColorRole, hex: string) => {
      apply((current) => commitSetColor(current, { slideId, elementId, colorRole, hex }));
    },
    [apply],
  );
  /**
   * Кегль или цвет сразу нескольким текстам — одной записью журнала. Склейка идёт внутри
   * одного обновления: объект, которому менять нечего, не склеит правку с чужой прежней.
   */
  const applyEach = useCallback(
    (
      elementIds: readonly string[],
      commit: (slides: readonly SlideIr[], elementId: string) => ReturnType<typeof commitMoves>,
    ) => {
      setHistory((current) => {
        let next = current;
        let first = true;
        for (const elementId of elementIds) {
          const result = commit(next.slides, elementId);
          if (!result.change) continue;
          next = recordChange(next, result, first ? undefined : { merge: true });
          first = false;
        }
        return next;
      });
    },
    [],
  );
  const setFontSizeAll = useCallback(
    (slideId: string, elementIds: readonly string[], sizePt: number) => {
      applyEach(elementIds, (slides, elementId) =>
        commitSetFontSize(slides, { slideId, elementId, sizePt }),
      );
    },
    [applyEach],
  );
  const setColorAll = useCallback(
    (slideId: string, elementIds: readonly string[], colorRole: ColorRole, hex: string) => {
      applyEach(elementIds, (slides, elementId) =>
        commitSetColor(slides, { slideId, elementId, colorRole, hex }),
      );
    },
    [applyEach],
  );
  const setProps = useCallback(
    (slideId: string, elementIds: readonly string[], props: ElementProps) => {
      apply((current) => commitElementProps(current, { slideId, elementIds, props }));
    },
    [apply],
  );
  const duplicate = useCallback(
    (slideId: string, elementIds: readonly string[], offset?: Offset) => {
      apply((current) => commitDuplicate(current, { slideId, elementIds, offset }));
    },
    [apply],
  );
  const paste = useCallback(
    (slideId: string, elements: readonly SlideElement[], offset?: Offset) => {
      apply((current) => commitPaste(current, { slideId, elements, offset }));
    },
    [apply],
  );
  const arrange = useCallback(
    (slideId: string, elementIds: readonly string[], to: ArrangeTarget) => {
      apply((current) => commitArrange(current, { slideId, elementIds, to }));
    },
    [apply],
  );
  const replaceImage = useCallback(
    (slideId: string, elementId: string, mediaPart: string) => {
      apply((current) => commitReplaceImage(current, { slideId, elementId, mediaPart }));
    },
    [apply],
  );
  const setTableCell = useCallback(
    (slideId: string, elementId: string, cell: TableCell, text: string) => {
      apply((current) => commitTableCell(current, { slideId, elementId, cell, text }));
    },
    [apply],
  );
  const insertTableRow = useCallback(
    (slideId: string, elementId: string, index: number) => {
      apply((current) => commitInsertTableRow(current, { slideId, elementId, index }));
    },
    [apply],
  );
  const removeTableRow = useCallback(
    (slideId: string, elementId: string, index: number) => {
      apply((current) => commitRemoveTableRow(current, { slideId, elementId, index }));
    },
    [apply],
  );
  const insertTableColumn = useCallback(
    (slideId: string, elementId: string, index: number) => {
      apply((current) => commitInsertTableColumn(current, { slideId, elementId, index }));
    },
    [apply],
  );
  const removeTableColumn = useCallback(
    (slideId: string, elementId: string, index: number) => {
      apply((current) => commitRemoveTableColumn(current, { slideId, elementId, index }));
    },
    [apply],
  );
  const setChartData = useCallback(
    (
      slideId: string,
      elementId: string,
      categories: readonly string[],
      series: readonly ChartSeries[],
    ) => {
      apply((current) => commitChartData(current, { slideId, elementId, categories, series }));
    },
    [apply],
  );
  const setChartAxes = useCallback(
    (slideId: string, elementId: string, titles: { xTitle?: string; yTitle?: string }) => {
      apply((current) => commitChartAxes(current, { slideId, elementId, ...titles }));
    },
    [apply],
  );
  const insertSlide = useCallback(
    (index: number, slide: SlideIr) => {
      apply((current) => commitInsertSlide(current, { index, slide }));
    },
    [apply],
  );
  const duplicateSlide = useCallback(
    (slideId: string) => {
      apply((current) => commitDuplicateSlide(current, { slideId }));
    },
    [apply],
  );
  const removeSlide = useCallback(
    (slideId: string) => {
      apply((current) => commitRemoveSlide(current, { slideId }));
    },
    [apply],
  );
  const setSlideBackground = useCallback(
    (slideId: string, background: ColorRole | null) => {
      apply((current) => commitSlideBackground(current, { slideId, background }));
    },
    [apply],
  );
  const undo = useCallback(() => {
    setHistory((current) => undoDeck(current));
  }, []);
  const redo = useCallback(() => {
    setHistory((current) => redoDeck(current));
  }, []);

  return {
    slides: history.slides,
    move,
    setText,
    remove,
    reorder,
    insert,
    setFontSize,
    setColor,
    setFontSizeAll,
    setColorAll,
    setProps,
    duplicate,
    paste,
    arrange,
    replaceImage,
    setTableCell,
    insertTableRow,
    removeTableRow,
    insertTableColumn,
    removeTableColumn,
    setChartData,
    setChartAxes,
    insertSlide,
    duplicateSlide,
    removeSlide,
    setSlideBackground,
    undo,
    redo,
    undoKind: changeKind(history.undo.at(-1)),
    redoKind: changeKind(history.redo.at(-1)),
    /** Выделение, которое вернула последняя отмена или повтор. Null после любого другого шага. */
    restored: history.restored as DeckSelection | null,
    /** Последняя правка в журнале: по её выделению «после» шелл выделяет вставленное. */
    lastChange: (history.undo.at(-1) ?? null) as DeckChange | null,
  };
}
