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
  const pixels =
    deltaMode === 1 ? deltaY * LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * 400 : deltaY;
  const limited = Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, pixels));
  return Math.exp(-limited * WHEEL_ZOOM_PER_PIXEL);
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

/**
 * Сдвиг содержимого, который библиотека зума и сама бы оставила: увеличенный лист не отходит
 * от краёв области, уменьшенный стоит по центру. Иначе следующий пан «доехал» бы сам.
 */
export function clampPosition(position: number, wrapperSize: number, scale: number): number {
  const content = wrapperSize * scale;
  if (content <= wrapperSize) return (wrapperSize - content) / 2;
  return Math.min(0, Math.max(wrapperSize - content, position));
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
