'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Box, ColorValue, Paragraph, SlideElement, SlideIr } from '@lct/contracts';
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
  type DeckCommit,
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

/**
 * `commit` — запись в журнал. `preview` — живой вид на время жеста (перетаскивание за подпись
 * поля, пикер цвета): слайды показывают правку, журнал её не видит. Жест кончается записью
 * или `endPreview`.
 */
export type EditMode = 'commit' | 'preview';

/** Свои свойства каждой группе объектов — одной записью журнала. */
export interface PropsEntry {
  readonly elementIds: readonly string[];
  readonly props: ElementProps;
}

/** Кегль одного текстового объекта. */
export interface FontSizeEntry {
  readonly elementId: string;
  readonly sizePt: number;
}

type Commit = (slides: readonly SlideIr[]) => DeckCommit;

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
  /** Правка, которую сейчас показывают, не записав: см. `EditMode`. */
  const [preview, setPreview] = useState<Commit | null>(null);
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setHistory(createDeckHistory(slides));
    setPreview(null);
  }

  const shown = useMemo(
    () => (preview ? preview(history.slides).slides : history.slides),
    [history.slides, preview],
  );

  /** Одна правка — одна запись журнала. Всё, что ниже, отличается только тем, что коммитит. */
  const apply = useCallback((commit: Commit, options?: RecordOptions) => {
    setPreview(null);
    setHistory((current) => recordChange(current, commit(current.slides), options));
  }, []);

  /**
   * Несколько правок одной записью журнала либо их живой вид. Склейка идёт внутри одного
   * обновления: правка, которой менять нечего, не склеит следующую с чужой прежней записью.
   */
  const applyAll = useCallback((commits: readonly Commit[], mode: EditMode = 'commit') => {
    if (mode === 'preview') {
      const composed: Commit = (slides) => ({
        slides: commits.reduce((current, commit) => commit(current).slides, slides),
        change: null,
      });
      setPreview(() => composed);
      return;
    }
    setPreview(null);
    setHistory((current) => {
      let next = current;
      let first = true;
      for (const commit of commits) {
        const result = commit(next.slides);
        if (!result.change) continue;
        next = recordChange(next, result, first ? undefined : { merge: true });
        first = false;
      }
      return next;
    });
  }, []);

  const endPreview = useCallback(() => setPreview(null), []);

  const move = useCallback(
    (slideId: string, moves: readonly ElementMove[], mode?: EditMode) => {
      applyAll([(current) => commitMoves(current, { slideId, moves })], mode);
    },
    [applyAll],
  );
  /**
   * Текст после набора. `box` — рамка, выросшая под текст: она ложится той же записью журнала,
   * и одна отмена возвращает и текст, и высоту.
   */
  const setText = useCallback(
    (
      slideId: string,
      elementId: string,
      paragraphs: readonly Paragraph[],
      options?: RecordOptions & { readonly box?: Box },
    ) => {
      const text: Commit = (current) => commitSetText(current, { slideId, elementId, paragraphs });
      const box = options?.box;
      if (!box) {
        apply(text, options);
        return;
      }
      applyAll([text, (current) => commitMoves(current, { slideId, moves: [{ elementId, box }] })]);
    },
    [apply, applyAll],
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
  /** Цвет текста: роль палитры или свой HEX; `hex` — чем красить runs. */
  const setColor = useCallback(
    (slideId: string, elementId: string, color: ColorValue, hex: string) => {
      apply((current) => commitSetColor(current, { slideId, elementId, color, hex }));
    },
    [apply],
  );
  /** Кегль нескольким текстам, каждому свой, — одной записью журнала. */
  const setFontSizes = useCallback(
    (slideId: string, entries: readonly FontSizeEntry[], mode?: EditMode) => {
      applyAll(
        entries.map(
          ({ elementId, sizePt }): Commit =>
            (slides) =>
              commitSetFontSize(slides, { slideId, elementId, sizePt }),
        ),
        mode,
      );
    },
    [applyAll],
  );
  const setColorAll = useCallback(
    (
      slideId: string,
      elementIds: readonly string[],
      color: ColorValue,
      hex: string,
      mode?: EditMode,
    ) => {
      applyAll(
        elementIds.map(
          (elementId): Commit =>
            (slides) =>
              commitSetColor(slides, { slideId, elementId, color, hex }),
        ),
        mode,
      );
    },
    [applyAll],
  );
  const setProps = useCallback(
    (slideId: string, elementIds: readonly string[], props: ElementProps, mode?: EditMode) => {
      applyAll([(current) => commitElementProps(current, { slideId, elementIds, props })], mode);
    },
    [applyAll],
  );
  /** Разные свойства разным объектам (поворот на 90° каждому от своего угла) — одной записью. */
  const setPropsEach = useCallback(
    (slideId: string, entries: readonly PropsEntry[], mode?: EditMode) => {
      applyAll(
        entries.map(
          ({ elementIds, props }): Commit =>
            (slides) =>
              commitElementProps(slides, { slideId, elementIds, props }),
        ),
        mode,
      );
    },
    [applyAll],
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
    (slideId: string, background: ColorValue | null, mode?: EditMode) => {
      applyAll([(current) => commitSlideBackground(current, { slideId, background })], mode);
    },
    [applyAll],
  );
  const undo = useCallback(() => {
    setPreview(null);
    setHistory((current) => undoDeck(current));
  }, []);
  const redo = useCallback(() => {
    setPreview(null);
    setHistory((current) => redoDeck(current));
  }, []);

  return {
    /** Что показывать: колода с живым видом жеста, если он идёт. */
    slides: shown,
    /** Колода без живого вида: от неё панель считает значения полей и правки «каждому своё». */
    committedSlides: history.slides,
    move,
    setText,
    remove,
    reorder,
    insert,
    setFontSize,
    setColor,
    setFontSizes,
    setColorAll,
    setProps,
    setPropsEach,
    endPreview,
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
