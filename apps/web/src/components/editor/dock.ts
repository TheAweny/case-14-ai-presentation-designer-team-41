/**
 * Геометрия плавающей панели инструментов: четыре готовых зоны, свободное положение между
 * ними и магнит, который ловит панель у зоны. Чистые функции без React — так их видно
 * целиком и можно проверять в отрыве от разметки.
 *
 * Все координаты — от левого верхнего угла области, в которой живёт панель.
 */

export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type DockAxis = 'vertical' | 'horizontal';

export const DOCK_SIDES = ['left', 'right', 'top', 'bottom'] as const satisfies readonly DockSide[];

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

/**
 * `zone` — панель стоит в готовой зоне и держится её центра, как бы область ни менялась.
 * `free` — свободное положение: храним доли свободного места, поэтому после ресайза панель
 * остаётся на том же месте по смыслу, а не уезжает за край.
 *
 * Сторона у свободного положения тоже своя: она задаёт ориентацию панели и направление
 * выпадающих окон. Её выбирают в момент отпускания и больше не пересчитывают — иначе при
 * ресайзе окна панель разворачивалась бы сама по себе.
 */
export type DockState =
  { kind: 'zone'; side: DockSide } | { kind: 'free'; side: DockSide; x: number; y: number };

export const DOCK_DEFAULT: DockState = { kind: 'zone', side: 'left' };

/** Зазор между панелью и краем области. */
export const DOCK_MARGIN = 12;

/** Насколько близко к краю нужно подвести панель, чтобы зона её поймала. */
const SNAP_EDGE = 116;
/** Разброс вдоль края: доля его длины, но не меньше фиксированного минимума. */
const SNAP_SPREAD_RATIO = 0.32;
const SNAP_SPREAD_MIN = 128;

export const DOCK_STORAGE_KEY = 'lct.editor.tool-rail.dock';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function dockAxis(side: DockSide): DockAxis {
  return side === 'left' || side === 'right' ? 'vertical' : 'horizontal';
}

/**
 * Длины панели вдоль ряда кнопок и поперёк него. Панель разворачивается вместе с зоной, так
 * что примерять зону нужно к размеру панели именно в её ориентации.
 */
export type RailSpan = { main: number; cross: number };

export function railSpan(size: Size, axis: DockAxis): RailSpan {
  return axis === 'vertical'
    ? { main: size.height, cross: size.width }
    : { main: size.width, cross: size.height };
}

export function railSize(span: RailSpan, axis: DockAxis): Size {
  return axis === 'vertical'
    ? { width: span.cross, height: span.main }
    : { width: span.main, height: span.cross };
}

/** Сколько места остаётся панели после вычета её размера и зазоров по краям. */
function freeSpan(area: Size, size: Size) {
  return {
    x: Math.max(0, area.width - size.width - DOCK_MARGIN * 2),
    y: Math.max(0, area.height - size.height - DOCK_MARGIN * 2),
  };
}

export function clampToArea(point: Point, area: Size, size: Size): Point {
  const span = freeSpan(area, size);
  return {
    x: DOCK_MARGIN + clamp(point.x - DOCK_MARGIN, 0, span.x),
    y: DOCK_MARGIN + clamp(point.y - DOCK_MARGIN, 0, span.y),
  };
}

export function dockPointFromRatio(state: { x: number; y: number }, area: Size, size: Size): Point {
  const span = freeSpan(area, size);
  return {
    x: DOCK_MARGIN + clamp(state.x, 0, 1) * span.x,
    y: DOCK_MARGIN + clamp(state.y, 0, 1) * span.y,
  };
}

export function dockRatioFromPoint(point: Point, area: Size, size: Size): Point {
  const span = freeSpan(area, size);
  return {
    x: span.x === 0 ? 0 : clamp((point.x - DOCK_MARGIN) / span.x, 0, 1),
    y: span.y === 0 ? 0 : clamp((point.y - DOCK_MARGIN) / span.y, 0, 1),
  };
}

/** Левый верхний угол панели, стоящей в готовой зоне: у края и по центру этого края. */
export function dockZonePoint(side: DockSide, area: Size, size: Size): Point {
  const centerX = (area.width - size.width) / 2;
  const centerY = (area.height - size.height) / 2;
  switch (side) {
    case 'left':
      return { x: DOCK_MARGIN, y: centerY };
    case 'right':
      return { x: area.width - size.width - DOCK_MARGIN, y: centerY };
    case 'top':
      return { x: centerX, y: DOCK_MARGIN };
    case 'bottom':
      return { x: centerX, y: area.height - size.height - DOCK_MARGIN };
  }
}

export function centerOf(point: Point, size: Size): Point {
  return { x: point.x + size.width / 2, y: point.y + size.height / 2 };
}

/**
 * Ближайшая сторона области. Расстояния берём в долях ширины и высоты, поэтому область
 * делится на четыре сектора диагоналями: у панели в свободном положении ориентация и
 * направление окон те же, что были бы в ближайшей зоне.
 */
export function dockSideAt(center: Point, area: Size): DockSide {
  const width = Math.max(area.width, 1);
  const height = Math.max(area.height, 1);
  const gaps: Record<DockSide, number> = {
    left: center.x / width,
    right: 1 - center.x / width,
    top: center.y / height,
    bottom: 1 - center.y / height,
  };
  return DOCK_SIDES.reduce((best, side) => (gaps[side] < gaps[best] ? side : best));
}

/**
 * Зона, которая сейчас ловит панель, или `null`, если панель останется там, где её отпустили.
 * Ловим по центру панели: он должен быть и близко к краю, и рядом с серединой этого края —
 * иначе «зона слева» срабатывала бы в углу, где человек имел в виду свободное положение.
 */
export function dockSnapSide(center: Point, area: Size, size: Size): DockSide | null {
  const side = dockSideAt(center, area);
  const target = centerOf(dockZonePoint(side, area, size), size);
  const vertical = dockAxis(side) === 'vertical';
  const edgeGap = Math.abs(vertical ? center.x - target.x : center.y - target.y);
  const spreadGap = Math.abs(vertical ? center.y - target.y : center.x - target.x);
  const spread = Math.max(
    SNAP_SPREAD_MIN,
    (vertical ? area.height : area.width) * SNAP_SPREAD_RATIO,
  );
  return edgeGap <= SNAP_EDGE && spreadGap <= spread ? side : null;
}

function isSide(value: unknown): value is DockSide {
  return DOCK_SIDES.includes(value as DockSide);
}

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Разбор записи из localStorage: чужому или устаревшему значению не верим. */
export function parseDock(raw: string | null): DockState | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Record<string, unknown>;
  if (!isSide(state.side)) return null;
  if (state.kind === 'zone') return { kind: 'zone', side: state.side };
  if (state.kind === 'free' && isRatio(state.x) && isRatio(state.y)) {
    return { kind: 'free', side: state.side, x: clamp(state.x, 0, 1), y: clamp(state.y, 0, 1) };
  }
  return null;
}

export function readDock(): DockState | null {
  try {
    return parseDock(window.localStorage.getItem(DOCK_STORAGE_KEY));
  } catch {
    // Приватный режим или запрет на хранилище: панель просто встанет в зону по умолчанию.
    return null;
  }
}

export function writeDock(state: DockState) {
  try {
    window.localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Положение панели — не та потеря, из-за которой стоит ломать работу редактора.
  }
}
