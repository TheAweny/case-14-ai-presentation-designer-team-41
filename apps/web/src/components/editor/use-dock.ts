'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { animate, useMotionValue, useReducedMotion, type MotionValue } from 'motion/react';
import {
  DOCK_DEFAULT,
  centerOf,
  clampToArea,
  dockPointFromRatio,
  dockRatioFromPoint,
  dockSideAt,
  dockSnapSide,
  dockZonePoint,
  readDock,
  writeDock,
  type DockSide,
  type DockState,
  type Point,
  type Size,
} from './dock';

/** Пока указатель не ушёл дальше, это ещё клик по ручке, а не перетаскивание. */
const DRAG_THRESHOLD = 3;

/** Магнит: панель не щёлкает в зону, а доезжает до неё. */
const SNAP_SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.9 } as const;

/** Размер элемента в состоянии: от него зависят и зоны, и границы свободного хода. */
function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      // Тот же размер — тот же объект: пересчёт положения не должен идти на каждый кадр,
      // когда наблюдатель сообщает об изменении, которого на деле не было.
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };

    // Первый замер делаем сами: в фоновой вкладке наблюдатель молчит до её показа, а панели
    // нужно знать своё место уже к первому кадру.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

type DragState = { side: DockSide; snap: DockSide | null };

export type Dock = {
  /** Сдвиг панели внутри области. Во время перетаскивания пишется без ререндеров. */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** Сторона, к которой панель обращена: от неё зависят ориентация и направление окон. */
  side: DockSide;
  /** Зона, которая поймает панель, если отпустить её сейчас. */
  snap: DockSide | null;
  dragging: boolean;
  /** Пока позиция не посчитана по измеренным размерам, панель не показываем. */
  ready: boolean;
  area: Size;
  rail: Size;
  /** Обработчики ручки: перетаскивание идёт только за неё, кнопки остаются кнопками. */
  grip: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
  /** Перенос в готовую зону — для стрелок на ручке. */
  moveTo: (side: DockSide) => void;
};

/**
 * Положение панели инструментов: свободное перетаскивание, магнит к четырём зонам и память
 * в localStorage.
 *
 * `areaRef` — область, внутри которой панель ходит, `railRef` — обёртка самой панели: её
 * размер зависит и от ориентации, и от числа кнопок, поэтому зоны считаются по измерениям,
 * а не по константам.
 */
export function useDock({
  areaRef,
  railRef,
}: {
  areaRef: RefObject<HTMLElement | null>;
  railRef: RefObject<HTMLElement | null>;
}): Dock {
  const reduceMotion = useReducedMotion() === true;
  const area = useElementSize(areaRef);
  const rail = useElementSize(railRef);

  const [dock, setDock] = useState<DockState>(DOCK_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const side = drag?.side ?? dock.side;

  /**
   * Свежие размеры и положение для обработчиков указателя. Обработчики не должны
   * пересоздаваться на каждое движение мыши: ручка держит захват указателя, и её замена
   * в разметке прервала бы перетаскивание.
   */
  const railSize = useRef<Size>(rail);
  const sideNow = useRef<DockSide>(side);
  const dragNow = useRef<DragState | null>(drag);
  const point = useRef<Point>({ x: 0, y: 0 });
  const grab = useRef<Point>({ x: 0.5, y: 0.5 });
  const from = useRef<Point>({ x: 0, y: 0 });
  const moved = useRef(false);

  railSize.current = rail;
  sideNow.current = side;
  dragNow.current = drag;

  // Сохранённое положение читаем после монтирования: на сервере localStorage нет, а
  // расхождение серверной разметки с клиентской ломало бы гидратацию.
  useEffect(() => {
    const saved = readDock();
    if (saved) setDock(saved);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writeDock(dock);
  }, [dock, loaded]);

  // Положение покоя: пересчитывается при смене зоны, размера области и длины панели.
  useEffect(() => {
    if (!loaded || drag || area.width === 0 || rail.width === 0) return;

    const target =
      dock.kind === 'zone'
        ? dockZonePoint(dock.side, area, rail)
        : clampToArea(dockPointFromRatio(dock, area, rail), area, rail);
    point.current = target;

    // Первая раскладка и режим без анимаций: панель просто оказывается на месте.
    if (!ready || reduceMotion) {
      x.jump(target.x);
      y.jump(target.y);
      setReady(true);
      return;
    }

    // Новая пружина сама сменяет предыдущую, подхватывая её скорость. Останавливать старую
    // нельзя: длина панели плывёт, пока кнопки перестраиваются, и на каждый такой кадр
    // пружина начиналась бы заново — панель замирала бы на полпути к зоне.
    animate(x, target.x, SNAP_SPRING);
    animate(y, target.y, SNAP_SPRING);
  }, [dock, area, rail, drag, loaded, ready, reduceMotion, x, y]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const railElement = railRef.current;
      if (!railElement) return;

      const box = railElement.getBoundingClientRect();
      // Точку захвата держим долями от размера панели: панель разворачивается на ходу, и
      // ручка обязана остаться под курсором.
      grab.current = {
        x: box.width === 0 ? 0.5 : (event.clientX - box.left) / box.width,
        y: box.height === 0 ? 0.5 : (event.clientY - box.top) / box.height,
      };
      from.current = { x: event.clientX, y: event.clientY };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      const started: DragState = { side: sideNow.current, snap: null };
      dragNow.current = started;
      setDrag(started);
    },
    [railRef],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragNow.current) return;
      const areaElement = areaRef.current;
      if (!areaElement) return;

      // Клик по ручке не должен превращать зону в свободное положение, поэтому дрожь
      // в пределах порога панель не двигает.
      if (!moved.current) {
        const shift = Math.hypot(event.clientX - from.current.x, event.clientY - from.current.y);
        if (shift < DRAG_THRESHOLD) return;
        moved.current = true;
      }

      const box = areaElement.getBoundingClientRect();
      const bounds: Size = { width: box.width, height: box.height };
      const size = railSize.current;
      const next = clampToArea(
        {
          x: event.clientX - box.left - grab.current.x * size.width,
          y: event.clientY - box.top - grab.current.y * size.height,
        },
        bounds,
        size,
      );

      x.jump(next.x);
      y.jump(next.y);
      point.current = next;

      const center = centerOf(next, size);
      const aimed: DragState = {
        side: dockSideAt(center, bounds),
        snap: dockSnapSide(center, bounds, size),
      };
      const current = dragNow.current;
      if (current.side === aimed.side && current.snap === aimed.snap) return;
      dragNow.current = aimed;
      setDrag(aimed);
    },
    [areaRef, x, y],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const current = dragNow.current;
      if (!current) return;
      dragNow.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      // Панель не сдвинулась: это был клик по ручке, положение остаётся прежним.
      if (!moved.current) {
        setDrag(null);
        return;
      }

      const areaElement = areaRef.current;
      if (current.snap) {
        setDock({ kind: 'zone', side: current.snap });
      } else if (areaElement) {
        const box = areaElement.getBoundingClientRect();
        const ratio = dockRatioFromPoint(
          point.current,
          { width: box.width, height: box.height },
          railSize.current,
        );
        setDock({ kind: 'free', side: current.side, x: ratio.x, y: ratio.y });
      }
      setDrag(null);
    },
    [areaRef],
  );

  const moveTo = useCallback((side: DockSide) => setDock({ kind: 'zone', side }), []);

  /** Двойной клик по ручке прижимает панель к ближайшей зоне: удобно после свободного хода. */
  const snapToNearest = useCallback(() => {
    const areaElement = areaRef.current;
    if (!areaElement) return;
    const box = areaElement.getBoundingClientRect();
    const center = centerOf(point.current, railSize.current);
    setDock({ kind: 'zone', side: dockSideAt(center, { width: box.width, height: box.height }) });
  }, [areaRef]);

  return {
    x,
    y,
    side,
    snap: drag?.snap ?? null,
    dragging: drag !== null,
    ready,
    area,
    rail,
    grip: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      // Если браузер отдал захват кому-то ещё, панель не должна остаться приклеенной к курсору.
      onLostPointerCapture: finish,
      onDoubleClick: snapToNearest,
    },
    moveTo,
  };
}
