'use client';

import { createContext, useContext } from 'react';

/*
 * Масштаб холста. Единица библиотеки зума — «вписать»: лист уже вписан в область контейнером
 * размеров. «100 %» — это слайд в свою величину из шаблона; перевод одного в другое живёт в
 * `zoom-input.ts` рядом с подписью зума.
 */

/** Меньше «вписать» можно отдалить до четверти. */
export const MIN_CANVAS_SCALE = 0.25;
export const MAX_CANVAS_SCALE = 8;
/** Один шаг Ctrl/Cmd+= и Ctrl/Cmd+−. */
export const KEY_ZOOM_FACTOR = 1.25;
/** Зазор вокруг выделения при «к выделению», доля видимой области с каждой стороны. */
export const SELECTION_ZOOM_PADDING = 0.12;

/** Натуральный логарифм шага за один щелчок колеса мыши (deltaY = 100): примерно ×1,2. */
const WHEEL_ZOOM_PER_PIXEL = Math.log(1.2) / 100;
/** Один щелчок колеса больше этого не даёт, даже если браузер прислал крупную дельту. */
const WHEEL_DELTA_LIMIT = 120;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

export function clampCanvasScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, MIN_CANVAS_SCALE), MAX_CANVAS_SCALE);
}

/**
 * Во сколько раз изменить масштаб от одного события колеса с Ctrl/Cmd. Мышь даёт крупные
 * щелчки, щипок на тачпаде — много мелких дельт; шкала одна и та же, поэтому щипок плавный,
 * а щелчок колеса — умеренный шаг, а не прыжок на 150 %.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const limited = Math.max(
    -WHEEL_DELTA_LIMIT,
    Math.min(WHEEL_DELTA_LIMIT, wheelPixels(deltaY, deltaMode)),
  );
  return Math.exp(-limited * WHEEL_ZOOM_PER_PIXEL);
}

/** Дельта колеса в пикселях: строки и страницы браузер присылает в своих единицах. */
function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
}

/** Что просит событие колеса: зум к курсору или сдвиг листа на столько-то экранных пикселей. */
export type WheelIntent =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number };

/**
 * Колесо на холсте, как в Figma. Ctrl/Cmd+колесо и щипок тачпада (браузер шлёт его колесом с
 * Ctrl) — зум. Иначе колесо двигает лист: само по себе — по вертикали, с Shift — по
 * горизонтали, два пальца тачпада — куда их повели. `dx`/`dy` — на сколько сдвинуть сам лист:
 * прокрутка вниз поднимает его вверх.
 */
export function wheelIntent(event: {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}): WheelIntent {
  const mode = event.deltaMode ?? 0;
  if (event.ctrlKey || event.metaKey) {
    return { kind: 'zoom', factor: wheelZoomFactor(event.deltaY, mode) };
  }
  let x = wheelPixels(event.deltaX, mode);
  let y = wheelPixels(event.deltaY, mode);
  // Shift+колесо мыши: одни браузеры сами переносят дельту на ось X, другие — нет.
  if (event.shiftKey && x === 0) {
    x = y;
    y = 0;
  }
  return { kind: 'pan', dx: -x || 0, dy: -y || 0 };
}

export interface ViewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Масштаб и сдвиг, при которых прямоугольник (в экранных пикселях) встаёт в центр видимой
 * области с полями. `positionX`/`positionY` — сдвиг содержимого библиотеки зума.
 */
export function transformToFit(
  rect: ViewRect,
  wrapper: ViewRect,
  current: { readonly scale: number; readonly positionX: number; readonly positionY: number },
  padding = SELECTION_ZOOM_PADDING,
): { scale: number; positionX: number; positionY: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || wrapper.width <= 0 || wrapper.height <= 0) {
    return null;
  }
  if (current.scale <= 0) return null;
  // В координатах содержимого: они не зависят от текущего зума.
  const left = (rect.left - wrapper.left - current.positionX) / current.scale;
  const top = (rect.top - wrapper.top - current.positionY) / current.scale;
  const width = rect.width / current.scale;
  const height = rect.height / current.scale;
  const room = Math.max(0, 1 - padding * 2);
  const scale = clampCanvasScale(
    Math.min((wrapper.width * room) / width, (wrapper.height * room) / height),
  );
  return {
    scale,
    positionX: wrapper.width / 2 - (left + width / 2) * scale,
    positionY: wrapper.height / 2 - (top + height / 2) * scale,
  };
}

/** Сдвиг и масштаб библиотеки зума: экранная точка = начало области + сдвиг + точка × масштаб. */
export interface CanvasTransform {
  readonly scale: number;
  readonly positionX: number;
  readonly positionY: number;
}

/** Запас поля вокруг слайда, доля его стороны: за край можно отъехать на полслайда. */
export const PASTEBOARD_MARGIN = 0.5;

/**
 * Поле вокруг слайда, по которому можно ездить панорамой: слайд с запасом с каждой стороны и
 * все объекты, даже вынесенные далеко за край. Координаты — содержимого зума, без масштаба.
 *
 * Запас — полслайда или `room`, что больше. Холст передаёт в `room` половину видимой области
 * в тех же координатах: тогда и во «вписать», где слайд занимает почти весь экран, его край
 * можно отвести до середины экрана.
 */
export function pasteboardRegion(
  slide: ViewRect,
  objects: readonly ViewRect[] = [],
  room: { readonly width: number; readonly height: number } = { width: 0, height: 0 },
  margin = PASTEBOARD_MARGIN,
): ViewRect {
  const aside = Math.max(slide.width * margin, room.width);
  const above = Math.max(slide.height * margin, room.height);
  let left = slide.left - aside;
  let top = slide.top - above;
  let right = slide.left + slide.width + aside;
  let bottom = slide.top + slide.height + above;
  for (const item of objects) {
    left = Math.min(left, item.left);
    top = Math.min(top, item.top);
    right = Math.max(right, item.left + item.width);
    bottom = Math.max(bottom, item.top + item.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

function clampAxis(
  next: number,
  previous: number,
  viewport: number,
  start: number,
  size: number,
  scale: number,
): number {
  // Край поля у края области: поле больше области — область не выходит за поле, меньше —
  // поле целиком на виду. Уже стоящий снаружи вид не выталкивается рывком: дальше наружу
  // нельзя, обратно — можно.
  const startAtStart = -start * scale;
  const endAtEnd = viewport - (start + size) * scale;
  const low = Math.min(startAtStart, endAtEnd, previous);
  const high = Math.max(startAtStart, endAtEnd, previous);
  return Math.min(Math.max(next, low), high);
}

/**
 * Сдвиг панорамы в пределах поля вокруг слайда. `previous` — сдвиг до жеста при том же
 * масштабе: вид, который уже снаружи (после зума или смены размера окна), не прыгает.
 */
export function clampToRegion(
  next: CanvasTransform,
  previous: CanvasTransform,
  viewport: { readonly width: number; readonly height: number },
  region: ViewRect,
): CanvasTransform {
  if (!(next.scale > 0)) return next;
  const same = previous.scale === next.scale;
  return {
    scale: next.scale,
    positionX: clampAxis(
      next.positionX,
      same ? previous.positionX : next.positionX,
      viewport.width,
      region.left,
      region.width,
      next.scale,
    ),
    positionY: clampAxis(
      next.positionY,
      same ? previous.positionY : next.positionY,
      viewport.height,
      region.top,
      region.height,
      next.scale,
    ),
  };
}

/** Новый масштаб так, чтобы точка под курсором (в пикселях области) осталась на месте. */
export function zoomAtPoint(
  current: CanvasTransform,
  point: { readonly x: number; readonly y: number },
  nextScale: number,
): CanvasTransform {
  const scale = clampCanvasScale(nextScale);
  if (!(current.scale > 0)) return { ...current, scale };
  const ratio = scale / current.scale;
  return {
    scale,
    positionX: point.x - (point.x - current.positionX) * ratio,
    positionY: point.y - (point.y - current.positionY) * ratio,
  };
}

/**
 * Команды вида холста. Их дают клавиши холста, и их же может звать подпись зума: она рисуется
 * внутри `SlideCanvas`, поэтому контекст ей доступен через `useCanvasView()`.
 */
export interface CanvasView {
  /** Масштаб библиотеки, при котором слайд показан в свою величину из шаблона (100 %). */
  readonly actualScale: number;
  zoomToFit(): void;
  zoomToActual(): void;
  /** К выделению; без выделения — ко всему слайду. */
  zoomToSelection(): void;
  /** Умножить масштаб, держа центр видимой области на месте. */
  zoomBy(factor: number): void;
}

export const CanvasViewContext = createContext<CanvasView | null>(null);

export function useCanvasView(): CanvasView | null {
  return useContext(CanvasViewContext);
}
