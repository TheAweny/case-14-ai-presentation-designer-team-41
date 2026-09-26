'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { canvasKeyCommand } from '@/components/editor/canvas-keys';
import {
  clampToRegion,
  KEY_ZOOM_FACTOR,
  pasteboardRegion,
  wheelIntent,
  zoomAtPoint,
  type CanvasTransform,
  type CanvasView,
  type ViewRect,
} from '@/components/editor/canvas-viewport';
import { isTypingTarget } from '@/components/editor/slide-navigation';

/** Интерфейс поверх холста: левая кнопка здесь нажимает, а не тащит лист даже рукой. */
const CANVAS_CHROME =
  '[data-text-editor], [data-text-format], [data-table-editor], [data-selection-bar], [data-dock-obstacle], button, input, [role="toolbar"], [role="group"], [role="menu"]';
/** Пробел здесь — своя клавиша: нажать кнопку, поднять миниатюру для перестановки. */
const SPACE_OWNERS =
  'button, a, [role="listbox"], [role="toolbar"], [role="menu"], [role="dialog"]';
/** Открытое окно (шпаргалка, показ) держит клавиатуру у себя: зум холста под ним не нужен. */
const KEY_DIALOGS = '[role="dialog"]';

type Controls = ReactZoomPanPinchContentRef;

function isFormField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select') !== null;
}

function transformOf(controls: Controls): CanvasTransform {
  const { scale, positionX, positionY } = controls.instance.state;
  return { scale, positionX, positionY };
}

/** Поле вокруг слайда в координатах содержимого зума: слайд с запасом и все его объекты. */
function regionOf(controls: Controls, slideRoot: HTMLElement): ViewRect | null {
  const wrapper = controls.instance.wrapperComponent;
  if (!wrapper) return null;
  const origin = wrapper.getBoundingClientRect();
  const { scale, positionX, positionY } = controls.instance.state;
  if (!(scale > 0)) return null;
  const toContent = (rect: DOMRect): ViewRect => ({
    left: (rect.left - origin.left - positionX) / scale,
    top: (rect.top - origin.top - positionY) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  });
  const objects = [...slideRoot.querySelectorAll<HTMLElement>('[data-element-id]')].map((element) =>
    toContent(element.getBoundingClientRect()),
  );
  // Полэкрана запаса: край слайда можно отвести до середины области при любом зуме.
  const room = { width: origin.width / scale / 2, height: origin.height / scale / 2 };
  return pasteboardRegion(toContent(slideRoot.getBoundingClientRect()), objects, room);
}

/**
 * Сдвинуть лист панорамой в пределах поля вокруг слайда. Масштаб остаётся прежним; вид,
 * который уже стоит снаружи поля, не выталкивается рывком.
 */
export function panCanvas(
  controls: Controls,
  slideRoot: HTMLElement | null,
  positionX: number,
  positionY: number,
  from: CanvasTransform = transformOf(controls),
): void {
  const wrapper = controls.instance.wrapperComponent;
  const current = transformOf(controls);
  const next = { scale: current.scale, positionX, positionY };
  const region = slideRoot ? regionOf(controls, slideRoot) : null;
  const bounded =
    wrapper && region
      ? clampToRegion(
          next,
          from,
          { width: wrapper.clientWidth, height: wrapper.clientHeight },
          region,
        )
      : next;
  if (bounded.positionX === current.positionX && bounded.positionY === current.positionY) return;
  void controls.setTransform(bounded.positionX, bounded.positionY, bounded.scale, 0);
}

/** Зум к точке экрана: точка под курсором остаётся на месте. */
export function zoomCanvasAt(
  controls: Controls,
  clientX: number,
  clientY: number,
  scale: number,
  animationTime = 0,
): void {
  const wrapper = controls.instance.wrapperComponent;
  if (!wrapper) return;
  const origin = wrapper.getBoundingClientRect();
  const current = transformOf(controls);
  const next = zoomAtPoint(current, { x: clientX - origin.left, y: clientY - origin.top }, scale);
  if (next.scale === current.scale) return;
  void controls.setTransform(next.positionX, next.positionY, next.scale, animationTime);
}

/**
 * Навигация по холсту, как в Figma и Pitch.
 *
 * - Средняя кнопка (зажатое колесо) тащит лист из любого инструмента, без автопрокрутки
 *   браузера. Рука и зажатый пробел тащат левой кнопкой.
 * - Колесо без модификаторов двигает лист по вертикали, с Shift — по горизонтали, два пальца
 *   тачпада — куда их повели. Ctrl/Cmd+колесо и щипок — зум к курсору.
 * - Ctrl/Cmd+=/−/0, Shift+1, Shift+2 — зум с клавиатуры (`canvasKeyCommand`).
 *
 * Панорама ездит по полю вокруг слайда (`pasteboardRegion`): видно, что вынесено за край.
 */
export function useCanvasNavigation({
  area,
  slideRoot,
  transformRef,
  handTool,
  view,
}: {
  /** Видимая область холста: здесь слушаются мышь и колесо. */
  area: HTMLElement | null;
  slideRoot: HTMLElement | null;
  transformRef: RefObject<Controls | null>;
  /** Инструмент «рука» на рейке: левая кнопка всегда тащит лист. */
  handTool: boolean;
  view: CanvasView;
}): {
  /** Зажат пробел: временная рука. */
  spacePan: boolean;
  /** Лист тащат прямо сейчас: курсор «сжатая рука». */
  panning: boolean;
} {
  const [spacePan, setSpacePan] = useState(false);
  const [panning, setPanning] = useState(false);
  const latest = useRef({ slideRoot, view, leftPans: handTool || spacePan });
  useEffect(() => {
    latest.current = { slideRoot, view, leftPans: handTool || spacePan };
  });

  // Пробел временно включает руку, отпустил — вернулся прежний инструмент. В поле ввода и на
  // кнопках он остаётся прежним: пробел в списке слайдов поднимает миниатюру для перестановки.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || isTypingTarget(event.target)) return;
      const target = event.target;
      if (target instanceof Element && target.closest(SPACE_OWNERS)) return;
      event.preventDefault();
      if (!event.repeat) setSpacePan(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePan(false);
    };
    const clear = () => setSpacePan(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Клавиши зума. Браузерный зум страницы перехватывается: в редакторе он только мешает.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest(KEY_DIALOGS)) return;
      const command = canvasKeyCommand(event, {
        formField: isFormField(event.target),
        typing: isTypingTarget(event.target),
      });
      if (!command) return;
      event.preventDefault();
      const { view: current } = latest.current;
      if (command === 'zoom-in') current.zoomBy(KEY_ZOOM_FACTOR);
      else if (command === 'zoom-out') current.zoomBy(1 / KEY_ZOOM_FACTOR);
      else if (command === 'zoom-actual') current.zoomToActual();
      else if (command === 'zoom-fit') current.zoomToFit();
      else current.zoomToSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Колесо: зум к курсору или панорама. Слушатель на погружении и не пассивный: иначе браузер
  // успел бы прокрутить или увеличить страницу.
  useEffect(() => {
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      const controls = transformRef.current;
      if (!controls) return;
      event.preventDefault();
      event.stopPropagation();
      const intent = wheelIntent(event);
      if (intent.kind === 'zoom') {
        const scale = controls.instance.state.scale;
        zoomCanvasAt(controls, event.clientX, event.clientY, scale * intent.factor);
        return;
      }
      const { positionX, positionY } = controls.instance.state;
      panCanvas(controls, latest.current.slideRoot, positionX + intent.dx, positionY + intent.dy);
    };
    // Safari шлёт щипок тачпада жестом, а не колесом с Ctrl: без этого он увеличил бы страницу.
    let gestureStart = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = transformRef.current?.instance.state.scale ?? 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const controls = transformRef.current;
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!controls || typeof gesture.scale !== 'number') return;
      zoomCanvasAt(
        controls,
        gesture.clientX ?? 0,
        gesture.clientY ?? 0,
        gestureStart * gesture.scale,
      );
    };
    area.addEventListener('wheel', onWheel, { passive: false, capture: true });
    area.addEventListener('gesturestart', onGestureStart);
    area.addEventListener('gesturechange', onGestureChange);
    return () => {
      area.removeEventListener('wheel', onWheel, { capture: true });
      area.removeEventListener('gesturestart', onGestureStart);
      area.removeEventListener('gesturechange', onGestureChange);
    };
  }, [area, transformRef]);

  // Перетаскивание листа. Слушатели на погружении у области: жест забирается раньше рамки
  // выделения, ручек и вставки, и они его не видят.
  useEffect(() => {
    if (!area) return;
    let drag: {
      pointer: number;
      x: number;
      y: number;
      from: CanvasTransform;
    } | null = null;

    const pans = (event: MouseEvent) => {
      if (event.button === 1) return true;
      if (event.button !== 0 || !latest.current.leftPans) return false;
      return !(event.target instanceof Element && event.target.closest(CANVAS_CHROME));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (drag || !pans(event)) return;
      const controls = transformRef.current;
      if (!controls) return;
      event.stopPropagation();
      // Левую кнопку гасим целиком: без mousedown рамка выделения и ручки жест не начнут.
      // Среднюю — в mousedown ниже: только там браузер начинает автопрокрутку.
      if (event.button === 0) event.preventDefault();
      drag = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: transformOf(controls),
      };
      area.setPointerCapture(event.pointerId);
      setPanning(true);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const controls = transformRef.current;
      if (!controls) return;
      panCanvas(
        controls,
        latest.current.slideRoot,
        drag.from.positionX + event.clientX - drag.x,
        drag.from.positionY + event.clientY - drag.y,
        drag.from,
      );
    };
    const finish = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
      drag = null;
      setPanning(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!pans(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Средний клик по ссылке открыл бы вкладку, на Linux — вставил бы выделенный текст.
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    area.addEventListener('pointerdown', onPointerDown, true);
    area.addEventListener('pointermove', onPointerMove, true);
    area.addEventListener('pointerup', finish, true);
    area.addEventListener('pointercancel', finish, true);
    area.addEventListener('lostpointercapture', finish, true);
    area.addEventListener('mousedown', onMouseDown, true);
    area.addEventListener('auxclick', onAuxClick, true);
    return () => {
      area.removeEventListener('pointerdown', onPointerDown, true);
      area.removeEventListener('pointermove', onPointerMove, true);
      area.removeEventListener('pointerup', finish, true);
      area.removeEventListener('pointercancel', finish, true);
      area.removeEventListener('lostpointercapture', finish, true);
      area.removeEventListener('mousedown', onMouseDown, true);
      area.removeEventListener('auxclick', onAuxClick, true);
      setPanning(false);
    };
  }, [area, transformRef]);

  return { spacePan, panning };
}
