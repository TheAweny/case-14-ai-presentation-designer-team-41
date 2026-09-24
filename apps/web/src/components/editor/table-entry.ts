'use client';

import { useEffect, useRef } from 'react';
import type { SlideIr } from '@lct/contracts';
import type { GridCell } from '@/components/editor/table-grid';

/** Дальше этого, в пикселях, щелчок уже протяжка: таблицу двигали, а не щёлкали по ячейке. */
const CLICK_SLOP_PX = 4;

/** Ячейка отрисованной таблицы под элементом: строка 0 — заголовок. */
export function cellUnder(target: Element): GridCell | null {
  const cell = target.closest('td');
  const row = cell?.parentElement;
  if (!cell || !(row instanceof HTMLTableRowElement)) return null;
  return { row: Math.max(0, row.rowIndex), column: Math.max(0, cell.cellIndex) };
}

/**
 * Второй щелчок по уже выделенной таблице ставит каретку в ячейку под курсором, как в
 * PowerPoint и Google Slides: первый выделяет таблицу, второй — внутрь. Протяжка таблицы
 * щелчком не считается.
 */
export function useTableClickEntry({
  host,
  slide,
  selectedIds,
  disabled,
  onEnter,
}: {
  host: HTMLElement | null;
  slide: SlideIr;
  selectedIds: readonly string[];
  disabled: boolean;
  onEnter: (elementId: string, focus: GridCell, point: { x: number; y: number }) => void;
}) {
  const latest = useRef({ slide, selectedIds, onEnter });
  latest.current = { slide, selectedIds, onEnter };

  useEffect(() => {
    if (!host || disabled) return;
    let press: { x: number; y: number; elementId: string } | null = null;
    const onDown = (event: PointerEvent) => {
      press = null;
      if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const mark = target.closest<HTMLElement>('[data-kind="table"]');
      const id = mark?.dataset.elementId;
      const { selectedIds: ids, slide: current } = latest.current;
      if (!id || ids.length !== 1 || ids[0] !== id || mark?.dataset.locked === 'true') return;
      const element = current.elements.find((item) => item.elementId === id);
      if (element?.kind !== 'table') return;
      press = { x: event.clientX, y: event.clientY, elementId: id };
    };
    const onClick = (event: MouseEvent) => {
      const started = press;
      press = null;
      if (!started || event.detail > 1) return;
      if (Math.hypot(event.clientX - started.x, event.clientY - started.y) > CLICK_SLOP_PX) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const mark = hit?.closest<HTMLElement>('[data-kind="table"]');
      if (!hit || mark?.dataset.elementId !== started.elementId) return;
      const cell = cellUnder(hit);
      if (!cell) return;
      latest.current.onEnter(started.elementId, cell, { x: event.clientX, y: event.clientY });
    };
    host.addEventListener('pointerdown', onDown, true);
    host.addEventListener('click', onClick, true);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      host.removeEventListener('click', onClick, true);
    };
  }, [disabled, host]);
}
