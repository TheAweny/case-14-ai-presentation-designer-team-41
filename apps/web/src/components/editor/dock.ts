/**
 * Геометрия плавающей панели инструментов: четыре готовых зоны, свободное положение между
 * ними и магнит, который ловит панель у зоны. Чистые функции без React — так их видно
 * целиком и можно проверять в отрыве от разметки.
 *
 * Все координаты — от левого верхнего угла области, в которой живёт панель.
 *
 * В области бывают и другие постоянные элементы — например, масштаб в углу холста. Это
 * препятствия: панель не встаёт на них ни в зоне, ни в свободном положении, а обходит вдоль
 * своего края.
 */

export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type DockAxis = 'vertical' | 'horizontal';

export const DOCK_SIDES = ['left', 'right', 'top', 'bottom'] as const satisfies readonly DockSide[];

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Rect = Point & Size;

/**
 * `zone` — панель стоит в готовой зоне и держится её центра, как бы область ни менялась.
 * `free` — свободное положение: храним доли свободного места, поэтому после ресайза панель
 * остаётся на том же месте по смыслу, а не уезжает за край.
 *
 * Сторона у свободного положения тоже своя: она задаёт ориентацию панели и направление
 * выпадающих окон. Ориентацию меняет только зона, поэтому при отпускании выбираем одну из
 * двух сторон той же оси и больше не пересчитываем — иначе при ресайзе окна панель
 * разворачивалась бы сама по себе.
 */
export type DockState =
  { kind: 'zone'; side: DockSide } | { kind: 'free'; side: DockSide; x: number; y: number };

export const DOCK_DEFAULT: DockState = { kind: 'zone', side: 'left' };

/** Зазор между панелью и краем области. */
export const DOCK_MARGIN = 12;

/** Зазор между панелью и препятствием: вплотную они читались бы как одна кнопка. */
export const DOCK_OBSTACLE_GAP = 8;

/** На сколько курсор может промахнуться мимо следа зоны, чтобы она всё ещё поймала панель. */
const SNAP_SLOP = 16;

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

/** Панель в `point` заходит на препятствие, считая зазор между ними. */
function hits(point: Point, size: Size, obstacle: Rect): boolean {
  const gap = DOCK_OBSTACLE_GAP;
  return (
    point.x < obstacle.x + obstacle.width + gap &&
    obstacle.x < point.x + size.width + gap &&
    point.y < obstacle.y + obstacle.height + gap &&
    obstacle.y < point.y + size.height + gap
  );
}

function hitsAny(point: Point, size: Size, obstacles: readonly Rect[]): boolean {
  return obstacles.some((obstacle) => hits(point, size, obstacle));
}

/**
 * Ближайшее место вдоль одной оси, где панель не задевает препятствий и не выходит за
 * поля области. Кандидаты — само место и позиции вплотную (с зазором) к каждому
 * препятствию с обеих сторон. `null` — вдоль этой оси места нет.
 */
function slideAlong(
  point: Point,
  size: Size,
  area: Size,
  obstacles: readonly Rect[],
  axis: 'x' | 'y',
): Point | null {
  const length = axis === 'x' ? size.width : size.height;
  const min = DOCK_MARGIN;
  const max = (axis === 'x' ? area.width : area.height) - length - DOCK_MARGIN;
  const from = point[axis];
  const candidates = [from];
  for (const obstacle of obstacles) {
    const start = obstacle[axis];
    const extent = axis === 'x' ? obstacle.width : obstacle.height;
    candidates.push(start - DOCK_OBSTACLE_GAP - length, start + extent + DOCK_OBSTACLE_GAP);
  }

  let best: Point | null = null;
  let bestShift = Infinity;
  for (const value of candidates) {
    if (value < min - 0.5 || value > max + 0.5) continue;
    const next = { ...point, [axis]: value };
    if (hitsAny(next, size, obstacles)) continue;
    const shift = Math.abs(value - from);
    if (shift < bestShift) {
      best = next;
      bestShift = shift;
    }
  }
  return best;
}

/**
 * Уводит панель с препятствий. `axis` — ось, вдоль которой разрешено двигаться: панель в
 * зоне ходит только вдоль своего края, свободная — по ближайшей из двух осей. Если места
 * нет, панель остаётся где была: в тесной области лучше наложиться, чем спрятать панель.
 */
export function avoidObstacles(
  point: Point,
  size: Size,
  area: Size,
  obstacles: readonly Rect[],
  axis: 'x' | 'y' | 'both' = 'both',
): Point {
  if (!hitsAny(point, size, obstacles)) return point;
  const options = (axis === 'both' ? (['x', 'y'] as const) : [axis])
    .map((along) => slideAlong(point, size, area, obstacles, along))
    .filter((option): option is Point => option !== null);
  let best = point;
  let bestShift = Infinity;
  for (const option of options) {
    const shift = Math.hypot(option.x - point.x, option.y - point.y);
    if (shift < bestShift) {
      best = option;
      bestShift = shift;
    }
  }
  return best;
}

export function clampToArea(
  point: Point,
  area: Size,
  size: Size,
  obstacles: readonly Rect[] = [],
): Point {
  const span = freeSpan(area, size);
  const clamped = {
    x: DOCK_MARGIN + clamp(point.x - DOCK_MARGIN, 0, span.x),
    y: DOCK_MARGIN + clamp(point.y - DOCK_MARGIN, 0, span.y),
  };
  return avoidObstacles(clamped, size, area, obstacles);
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

/**
 * Левый верхний угол панели, стоящей в готовой зоне: у края и по центру этого края. Если
 * середина края занята, панель сдвигается вдоль него ровно настолько, чтобы не задеть
 * препятствие.
 */
export function dockZonePoint(
  side: DockSide,
  area: Size,
  size: Size,
  obstacles: readonly Rect[] = [],
): Point {
  const centerX = (area.width - size.width) / 2;
  const centerY = (area.height - size.height) / 2;
  const point: Point =
    side === 'left'
      ? { x: DOCK_MARGIN, y: centerY }
      : side === 'right'
        ? { x: area.width - size.width - DOCK_MARGIN, y: centerY }
        : side === 'top'
          ? { x: centerX, y: DOCK_MARGIN }
          : { x: centerX, y: area.height - size.height - DOCK_MARGIN };
  return avoidObstacles(point, size, area, obstacles, dockAxis(side) === 'vertical' ? 'y' : 'x');
}

/** Место, которое панель займёт в зоне, в ориентации этой зоны. Его и рисуют следом. */
export function dockZoneRect(
  side: DockSide,
  area: Size,
  span: RailSpan,
  obstacles: readonly Rect[] = [],
): Rect {
  const size = railSize(span, dockAxis(side));
  return { ...dockZonePoint(side, area, size, obstacles), ...size };
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
 * Сторона той же оси, что ближе к центру панели. Нужна свободному положению: ориентация
 * остаётся прежней, а окна раскрываются туда, где больше места.
 */
export function dockSideOnAxis(center: Point, area: Size, axis: DockAxis): DockSide {
  if (axis === 'vertical') return center.x <= area.width / 2 ? 'left' : 'right';
  return center.y <= area.height / 2 ? 'top' : 'bottom';
}

/**
 * Зона, которая сейчас ловит панель, или `null`, если панель останется там, где её отпустили.
 *
 * Ловим по курсору, а не по центру панели: зона срабатывает, только когда курсор над её
 * следом, с небольшим допуском. Рядом со следом панель встаёт свободно — туда, куда её
 * поставили. Наружу от края допуска нет: курсор, ушедший за край области, тоже в зоне,
 * и до края можно не целиться.
 *
 * В тесной области следы могут перекрываться — тогда выигрывает тот, чей центр ближе.
 */
export function dockSnapSide(
  pointer: Point,
  area: Size,
  span: RailSpan,
  obstacles: readonly Rect[] = [],
): DockSide | null {
  let best: DockSide | null = null;
  let bestGap = Infinity;

  for (const side of DOCK_SIDES) {
    const zone = dockZoneRect(side, area, span, obstacles);
    const left = side === 'left' ? -Infinity : zone.x - SNAP_SLOP;
    const right = side === 'right' ? Infinity : zone.x + zone.width + SNAP_SLOP;
    const top = side === 'top' ? -Infinity : zone.y - SNAP_SLOP;
    const bottom = side === 'bottom' ? Infinity : zone.y + zone.height + SNAP_SLOP;
    if (pointer.x < left || pointer.x > right || pointer.y < top || pointer.y > bottom) continue;

    const center = centerOf(zone, zone);
    const gap = Math.hypot(pointer.x - center.x, pointer.y - center.y);
    if (gap < bestGap) {
      best = side;
      bestGap = gap;
    }
  }

  return best;
}

function isSide(value: unknown): value is DockSide {
  return DOCK_SIDES.includes(value as DockSide);
}

function isRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Разбор сохранённого положения: чужому или устаревшему значению не верим. */
export function toDockState(value: unknown): DockState | null {
  if (typeof value !== 'object' || value === null) return null;
  const state = value as Record<string, unknown>;
  if (!isSide(state.side)) return null;
  if (state.kind === 'zone') return { kind: 'zone', side: state.side };
  if (state.kind === 'free' && isRatio(state.x) && isRatio(state.y)) {
    return { kind: 'free', side: state.side, x: clamp(state.x, 0, 1), y: clamp(state.y, 0, 1) };
  }
  return null;
}

export function parseDock(raw: string | null): DockState | null {
  if (raw === null) return null;
  try {
    return toDockState(JSON.parse(raw));
  } catch {
    return null;
  }
}
