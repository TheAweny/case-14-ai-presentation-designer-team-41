'use client';

import { useSyncExternalStore } from 'react';
import type { TableRange } from '@lct/deck-ops';

/**
 * Открытая на холсте таблица и выделенные в ней ячейки. Панель «Дизайн» красит то, что
 * выделено, а без выделения — всю таблицу, как PowerPoint и Google Slides.
 */
export interface ActiveTable {
  readonly elementId: string;
  readonly range: TableRange;
}

let active: ActiveTable | null = null;
const listeners = new Set<() => void>();

function same(left: ActiveTable | null, right: ActiveTable | null): boolean {
  if (left === null || right === null) return left === right;
  const a = left.range;
  const b = right.range;
  return (
    left.elementId === right.elementId &&
    a.top === b.top &&
    a.left === b.left &&
    a.bottom === b.bottom &&
    a.right === b.right
  );
}

export function setActiveTable(next: ActiveTable | null): void {
  if (same(active, next)) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Снять регистрацию, только если открыта всё ещё эта таблица. */
export function clearActiveTable(elementId: string): void {
  if (active?.elementId === elementId) setActiveTable(null);
}

/** Что открыто сейчас: для обработчиков вне React. */
export function activeTable(): ActiveTable | null {
  return active;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveTable(): ActiveTable | null {
  return useSyncExternalStore(subscribe, activeTable, () => null);
}
