'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import type { SlideElement, SlideIr } from '@lct/contracts';
import { tableShares } from '@lct/deck-ops';
import { cn } from '@/lib/utils';
import type { TableOps } from '@/components/editor/use-table-ops';

type TableElement = Extract<SlideElement, { kind: 'table' }>;

/** Ширина полосы, за которую берут границу, в экранных пикселях при любом зуме. */
const GRIP_PX = 8;

/** Таблица на экране: рамка, правые края колонок и нижние края строк в пикселях слоя. */
interface Geometry {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  /** Высоты строк как нарисованы: строка вырастает под текст выше своей доли. */
  readonly rowHeights: readonly number[];
}

type Axis = 'column' | 'row';

/** Нарисованная таблица: в правке — редактор поверх, иначе сам объект слайда. */
function tableNode(slideRoot: HTMLElement, elementId: string, editing: boolean) {
  if (editing) {
    const editor = slideRoot.querySelector<HTMLTableElement>('[data-table-editor] table');
    if (editor) return editor;
  }
  return slideRoot.querySelector<HTMLTableElement>(
    `[data-element-id="${CSS.escape(elementId)}"] table`,
  );
}

function measure(overlay: HTMLElement, table: HTMLTableElement): Geometry | null {
  const origin = overlay.getBoundingClientRect();
  const frame = table.getBoundingClientRect();
  const rows = [...table.rows];
  const first = rows[0];
  if (!first || frame.width <= 0 || frame.height <= 0) return null;
  const rects = rows.map((row) => row.getBoundingClientRect());
  return {
    left: frame.left - origin.left,
    top: frame.top - origin.top,
    width: frame.width,
    height: frame.height,
    columns: [...first.cells].map((cell) => cell.getBoundingClientRect().right - origin.left),
    rows: rects.map((rect) => rect.bottom - origin.top),
    rowHeights: rects.map((rect) => rect.height),
  };
}

function sameGeometry(left: Geometry | null, right: Geometry | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Ширина текста колонки без переносов, с полями ячейки: сколько ей нужно, чтобы ни одна
 * ячейка не переносилась. Стиль ставится и снимается в том же кадре — на экран не попадает.
 */
function naturalColumnWidth(table: HTMLTableElement, column: number): number {
  let widest = 0;
  for (const row of table.rows) {
    const cell = row.cells[column];
    if (!cell) continue;
    const saved = cell.style.whiteSpace;
    cell.style.whiteSpace = 'pre';
    const range = document.createRange();
    range.selectNodeContents(cell);
    const text = range.getBoundingClientRect().width;
    cell.style.whiteSpace = saved;
    const style = getComputedStyle(cell);
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    widest = Math.max(widest, text + padding + 1);
  }
  return widest;
}

/** Высота строки по её тексту: строка без своей высоты сжимается до содержимого. */
function naturalRowHeight(table: HTMLTableElement, row: number): number | null {
  const node = table.rows[row];
  if (!node) return null;
  const saved = node.style.height;
  node.style.height = '0px';
  const height = node.getBoundingClientRect().height;
  node.style.height = saved;
  return height;
}

/**
 * Границы колонок и строк выделенной таблицы, за которые их тянут прямо на холсте, как в
 * PowerPoint: курсор col-resize и row-resize, живой вид на время протяжки, одна запись журнала
 * на жест, Esc отменяет. Двойной щелчок по границе подгоняет колонку или строку под текст.
 *
 * Слой лежит в экранных пикселях поверх холста, как ручки: полоса одной ширины при любом зуме.
 * Внешние правый и нижний края — только в правке ячеек: вне её там ручки рамки всей таблицы.
 */
export function TableHandles({
  overlay,
  slideRoot,
  slide,
  element,
  editing,
  ops,
}: {
  overlay: HTMLElement;
  slideRoot: HTMLElement;
  slide: SlideIr;
  element: TableElement;
  editing: boolean;
  ops: TableOps;
}) {
  const t = useTranslations('tableMenu');
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [active, setActive] = useState<{ axis: Axis; index: number } | null>(null);
  const gesture = useRef<{
    axis: Axis;
    index: number;
    pointerId: number;
    origin: number;
    start: number;
    emuPerPx: number;
    measured: readonly number[];
    moved: boolean;
  } | null>(null);
  const elementId = element.elementId;

  const update = useCallback(() => {
    const table = tableNode(slideRoot, elementId, editing);
    const next = table ? measure(overlay, table) : null;
    setGeometry((previous) => (sameGeometry(previous, next) ? previous : next));
  }, [editing, elementId, overlay, slideRoot]);

  // После каждой правки таблицы: протяжка меняет её живьём, и полоса идёт за границей.
  useLayoutEffect(() => {
    update();
  }, [update, element, slide]);
  useTransformEffect(() => {
    update();
  });
  useEffect(() => {
    const table = tableNode(slideRoot, elementId, editing);
    if (!table) return;
    // Набор в ячейке растит строку, а слайд при этом не меняется.
    const observer = new ResizeObserver(update);
    observer.observe(table);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [editing, elementId, overlay, slideRoot, update]);

  const emuPerPx = () => {
    const width = slideRoot.getBoundingClientRect().width;
    return width > 0 ? slide.slideCx / width : 0;
  };

  const apply = (axis: Axis, index: number, length: number, measured: readonly number[]) => {
    if (axis === 'column') ops.columnWidth(elementId, index, length, 'preview');
    else ops.rowHeight(elementId, index, length, measured, 'preview');
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, axis: Axis, index: number) => {
    if (event.button !== 0 || !geometry) return;
    // Иначе mousedown подхватили бы рамка выделения и перетаскивание таблицы целиком.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const scale = emuPerPx();
    const measured = geometry.rowHeights.map((height) => height * scale);
    const start =
      axis === 'column'
        ? (tableShares(element.columnWidths, element.headers.length)[index] ?? 0) * element.box.cx
        : (measured[index] ?? 0);
    gesture.current = {
      axis,
      index,
      pointerId: event.pointerId,
      origin: axis === 'column' ? event.clientX : event.clientY,
      start,
      emuPerPx: scale,
      measured,
      moved: false,
    };
    setActive({ axis, index });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const position = current.axis === 'column' ? event.clientX : event.clientY;
    const delta = (position - current.origin) * current.emuPerPx;
    if (!current.moved && Math.abs(position - current.origin) < 1) return;
    current.moved = true;
    apply(current.axis, current.index, current.start + delta, current.measured);
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    gesture.current = null;
    setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled || !current.moved) {
      ops.endPreview();
      return;
    }
    const position = current.axis === 'column' ? event.clientX : event.clientY;
    const length = current.start + (position - current.origin) * current.emuPerPx;
    if (current.axis === 'column') ops.columnWidth(elementId, current.index, length, 'commit');
    else ops.rowHeight(elementId, current.index, length, current.measured, 'commit');
  };

  // Esc посреди протяжки возвращает границу на место.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      gesture.current = null;
      setActive(null);
      ops.endPreview();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, ops]);

  const fit = (axis: Axis, index: number) => {
    const table = tableNode(slideRoot, elementId, editing);
    if (!table || !geometry) return;
    const scale = emuPerPx();
    if (axis === 'column') {
      ops.columnWidth(elementId, index, naturalColumnWidth(table, index) * scale, 'commit');
      return;
    }
    const natural = naturalRowHeight(table, index);
    if (natural === null) return;
    ops.rowHeight(
      elementId,
      index,
      natural * scale,
      geometry.rowHeights.map((height) => height * scale),
      'commit',
    );
  };

  if (!geometry) return null;
  const lastColumn = geometry.columns.length - 1;
  const lastRow = geometry.rows.length - 1;

  const grip = (axis: Axis, index: number, position: number) => {
    const vertical = axis === 'column';
    const on = active?.axis === axis && active.index === index;
    return (
      <div
        key={`${axis}-${index}`}
        role="separator"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label={t(vertical ? 'resizeColumn' : 'resizeRow', { index: index + 1 })}
        title={t('resizeHint')}
        onPointerDown={(event) => onPointerDown(event, axis, index)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => end(event, false)}
        onPointerCancel={(event) => end(event, true)}
        onDoubleClick={() => fit(axis, index)}
        className={cn(
          'group pointer-events-auto absolute touch-none',
          vertical ? 'cursor-col-resize' : 'cursor-row-resize',
        )}
        style={
          vertical
            ? {
                left: position - GRIP_PX / 2,
                top: geometry.top,
                width: GRIP_PX,
                height: geometry.height,
              }
            : {
                left: geometry.left,
                top: position - GRIP_PX / 2,
                width: geometry.width,
                height: GRIP_PX,
              }
        }
      >
        <div
          aria-hidden
          className={cn(
            'absolute bg-[var(--canvas-selection)] opacity-0 transition-opacity duration-100 group-hover:opacity-100 motion-reduce:transition-none',
            vertical
              ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
              : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
            on && 'opacity-100',
          )}
        />
      </div>
    );
  };

  return (
    <div data-table-editor="" data-table-handles="" className="absolute inset-0">
      {geometry.columns.map((x, index) =>
        index === lastColumn && !editing ? null : grip('column', index, x),
      )}
      {geometry.rows.map((y, index) =>
        index === lastRow && !editing ? null : grip('row', index, y),
      )}
    </div>
  );
}
