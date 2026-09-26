'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import { animate, useMotionValue, useReducedMotion, type MotionValue } from 'motion/react';
import {
  centerOf,
  clampToArea,
  dockAxis,
  dockPointFromRatio,
  dockRatioFromPoint,
  dockSideAt,
  dockSideOnAxis,
  dockSnapSide,
  dockZonePoint,
  railSpan,
  type DockSide,
  type DockState,
  type Point,
  type Rect,
  type Size,
} from './dock';

/** Пока указатель не ушёл дальше, это ещё клик по ручке, а не перетаскивание. */
const DRAG_THRESHOLD = 3;

/**
 * Доезд до зоны после отпускания. Короткое торможение без отскока: пружина на этом
 * пути читается как запаздывание за курсором.
 */
const SNAP_MOVE = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

/**
 * Элементы области, на которые панель не встаёт: масштаб холста, кнопка правой панели.
 * Разметка помечает их сама, и панель узнаёт о них измерением, а не из констант вёрстки.
 */
export const DOCK_OBSTACLE_ATTRIBUTE = 'data-dock-obstacle';

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

/** Препятствия в координатах области. Скрытые (нулевого размера) не мешают. */
function readObstacles(area: HTMLElement): Rect[] {
  const box = area.getBoundingClientRect();
  return [...area.querySelectorAll<HTMLElement>(`[${DOCK_OBSTACLE_ATTRIBUTE}]`)]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: rect.left - box.left,
      y: rect.top - box.top,
      width: rect.width,
      height: rect.height,
    }));
}

function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (rect, index) =>
        Math.abs(rect.x - (b[index]?.x ?? NaN)) < 0.5 &&
        Math.abs(rect.y - (b[index]?.y ?? NaN)) < 0.5 &&
        Math.abs(rect.width - (b[index]?.width ?? NaN)) < 0.5 &&
        Math.abs(rect.height - (b[index]?.height ?? NaN)) < 0.5,
    )
  );
}

/**
 * Следим за препятствиями: появились, пропали (ушли в `display: none`), сменили размер.
 * Сам список читается и прямо в расчёте положения — состояние здесь только повод
 * пересчитать его.
 */
function useObstacleSignal(areaRef: RefObject<HTMLElement | null>): number {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let watched: HTMLElement[] = [];
    let pending: number | null = null;
    const bump = () => setSignal((count) => count + 1);
    const sizes = new ResizeObserver(bump);

    const rescan = () => {
      pending = null;
      const next = [...area.querySelectorAll<HTMLElement>(`[${DOCK_OBSTACLE_ATTRIBUTE}]`)];
      if (next.length === watched.length && next.every((element, i) => element === watched[i])) {
        return;
      }
      for (const element of watched) sizes.unobserve(element);
      for (const element of next) sizes.observe(element);
      watched = next;
      bump();
    };
    // Разметка холста меняется часто, а препятствия — редко: пересматриваем их не чаще
    // одного раза за задачу.
    const schedule = () => {
      if (pending === null) pending = window.setTimeout(rescan, 0);
    };

    rescan();
    const mutations = new MutationObserver(schedule);
    mutations.observe(area, { childList: true, subtree: true });
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      mutations.disconnect();
      sizes.disconnect();
    };
  }, [areaRef]);

  return signal;
}

type DragState = { snap: DockSide | null };

export type Dock = {
  /** Сдвиг панели внутри области. Во время перетаскивания пишется без ререндеров. */
  x: MotionValue<number>;
  y: MotionValue<number>;
  /**
   * Сторона, к которой панель обращена: от неё зависят ориентация и направление окон.
   * Пока панель в руке, сторона не меняется, иначе панель разворачивалась бы под курсором.
   */
  side: DockSide;
  /** Зона, которая поймает панель, если отпустить её сейчас. */
  snap: DockSide | null;
  /** Панель тащат: указатель ушёл за порог. Простое нажатие на ручку сюда не относится. */
  dragging: boolean;
  /** Пока позиция не посчитана по измеренным размерам, панель не показываем. */
  ready: boolean;
  area: Size;
  rail: Size;
  /** Препятствия в области: по ним же рисуются следы зон. */
  obstacles: readonly Rect[];
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
 * Положение панели инструментов: свободное перетаскивание, магнит к четырём зонам и
 * препятствия, которые панель обходит.
 *
 * Панель в руке всё время сохраняет форму и едет строго за курсором. Куда она встанет,
 * показывают следы зон. Разворачивается панель только в момент отпускания в зоне.
 *
 * `areaRef` — область, внутри которой панель ходит, `railRef` — обёртка самой панели: её
 * размер зависит и от ориентации, и от числа кнопок, поэтому зоны считаются по измерениям,
 * а не по константам.
 *
 * Положение приходит снаружи (`initial`) и уходит туда же (`onChange`): хранит его
 * владелец раскладки, чтобы сервер знал его заранее.
 */
export function useDock({
  areaRef,
  railRef,
  initial,
  onChange,
}: {
  areaRef: RefObject<HTMLElement | null>;
  railRef: RefObject<HTMLElement | null>;
  initial: DockState;
  onChange?: (dock: DockState) => void;
}): Dock {
  const reduceMotion = useReducedMotion() === true;
  const area = useElementSize(areaRef);
  const rail = useElementSize(railRef);
  const obstacleSignal = useObstacleSignal(areaRef);

  const [dock, setDock] = useState<DockState>(initial);
  const [ready, setReady] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [obstacles, setObstacles] = useState<readonly Rect[]>([]);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const side = dock.side;

  /**
   * Свежие размеры и положение для обработчиков указателя. Обработчики не должны
   * пересоздаваться на каждое движение мыши: ручка держит захват указателя, и её замена
   * в разметке прервала бы перетаскивание.
   */
  const railSize = useRef<Size>(rail);
  const sideNow = useRef<DockSide>(side);
  const dragNow = useRef<DragState | null>(drag);
  const obstaclesNow = useRef<readonly Rect[]>(obstacles);
  const point = useRef<Point>({ x: 0, y: 0 });
  /** Смещение курсора от угла панели в момент нажатия: панель в руке не меняет форму. */
  const grab = useRef<Point>({ x: 0, y: 0 });
  const from = useRef<Point>({ x: 0, y: 0 });
  const pressed = useRef(false);
  /** Доезд до цели после отпускания. Пустой, когда панель стоит. */
  const settle = useRef<{ stop: () => void; finished: Promise<unknown> }[]>([]);
  const lastTarget = useRef<Point | null>(null);
  /** Положение, под которое панель в последний раз встала: по нему видно, что сменилось. */
  const placedDock = useRef<DockState | null>(null);
  const onChangeRef = useRef(onChange);
  const savedDock = useRef(dock);

  sideNow.current = side;
  dragNow.current = drag;
  obstaclesNow.current = obstacles;

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Сообщаем только о новых положениях: начальное владелец и так знает.
  useEffect(() => {
    if (savedDock.current === dock) return;
    savedDock.current = dock;
    onChangeRef.current?.(dock);
  }, [dock]);

  const stopSettle = useCallback(() => {
    for (const run of settle.current) run.stop();
    settle.current = [];
  }, []);

  useEffect(() => stopSettle, [stopSettle]);

  /**
   * Положение покоя. Считаем по живому размеру узла до отрисовки: панель разворачивается в
   * том же кадре, что и встаёт в зону, и состояние размера ещё старое. Препятствия тоже
   * читаем вживую: при первом показе панель сразу встаёт мимо них, а не переезжает кадром позже.
   * Во время перетаскивания панель не анимируется. После отпускания одна короткая поездка
   * до цели, и повторный замер её не перезапускает. Если же сменилась только длина панели,
   * размер области или препятствия, панель встаёт на место сразу.
   */
  useLayoutEffect(() => {
    const railElement = railRef.current;
    const areaElement = areaRef.current;
    if (!railElement || !areaElement) return;

    if (drag) {
      stopSettle();
      lastTarget.current = null;
      return;
    }

    const bounds = { width: areaElement.offsetWidth, height: areaElement.offsetHeight };
    const size = { width: railElement.offsetWidth, height: railElement.offsetHeight };
    if (bounds.width === 0 || size.width === 0) return;

    const blocked = readObstacles(areaElement);
    obstaclesNow.current = blocked;
    setObstacles((previous) => (sameRects(previous, blocked) ? previous : blocked));

    const target =
      dock.kind === 'zone'
        ? dockZonePoint(dock.side, bounds, size, blocked)
        : clampToArea(dockPointFromRatio(dock, bounds, size), bounds, size, blocked);
    point.current = target;
    const dockChanged = placedDock.current !== dock;
    placedDock.current = dock;

    const sameTarget =
      lastTarget.current !== null &&
      Math.abs(lastTarget.current.x - target.x) < 0.5 &&
      Math.abs(lastTarget.current.y - target.y) < 0.5;

    if (!ready || reduceMotion) {
      if (sameTarget && ready) return;
      stopSettle();
      x.jump(target.x);
      y.jump(target.y);
      lastTarget.current = target;
      if (!ready) setReady(true);
      return;
    }

    if (sameTarget && settle.current.length > 0) return;
    if (Math.abs(x.get() - target.x) < 0.5 && Math.abs(y.get() - target.y) < 0.5) {
      lastTarget.current = target;
      return;
    }

    // Сменилась не зона, а размеры вокруг неё: панель просто держится своего места.
    if (!dockChanged && settle.current.length === 0) {
      x.jump(target.x);
      y.jump(target.y);
      lastTarget.current = target;
      return;
    }

    stopSettle();
    lastTarget.current = target;
    const runs = [animate(x, target.x, SNAP_MOVE), animate(y, target.y, SNAP_MOVE)];
    settle.current = runs;
    const done = () => {
      if (settle.current === runs) settle.current = [];
    };
    void Promise.all(runs.map((run) => run.finished)).then(done, done);
  }, [
    dock,
    area,
    rail,
    drag,
    ready,
    reduceMotion,
    obstacleSignal,
    stopSettle,
    x,
    y,
    areaRef,
    railRef,
  ]);

  /**
   * Нажатие только запоминает, где взялись за панель. Перетаскивание начинается, когда
   * указатель уйдёт за порог: клик и двойной клик по ручке не показывают следы зон.
   */
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const railElement = railRef.current;
      const areaElement = areaRef.current;
      if (!railElement || !areaElement) return;

      const box = railElement.getBoundingClientRect();
      railSize.current = { width: railElement.offsetWidth, height: railElement.offsetHeight };
      // Пока панель в руке, препятствия не двигаются: снимаем их один раз.
      obstaclesNow.current = readObstacles(areaElement);
      grab.current = { x: event.clientX - box.left, y: event.clientY - box.top };
      from.current = { x: event.clientX, y: event.clientY };
      pressed.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [areaRef, railRef],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!pressed.current) return;
      const areaElement = areaRef.current;
      if (!areaElement) return;

      // Клик по ручке не должен превращать зону в свободное положение, поэтому дрожь
      // в пределах порога панель не двигает.
      if (!dragNow.current) {
        const shift = Math.hypot(event.clientX - from.current.x, event.clientY - from.current.y);
        if (shift < DRAG_THRESHOLD) return;
        // Доезд до прошлой цели ещё мог идти: он перебил бы сдвиг уже в следующем кадре.
        stopSettle();
      }

      const box = areaElement.getBoundingClientRect();
      const bounds: Size = { width: box.width, height: box.height };
      const size = railSize.current;
      const blocked = obstaclesNow.current;
      const cursor = { x: event.clientX - box.left, y: event.clientY - box.top };
      const next = clampToArea(
        { x: cursor.x - grab.current.x, y: cursor.y - grab.current.y },
        bounds,
        size,
        blocked,
      );

      x.jump(next.x);
      y.jump(next.y);
      point.current = next;

      const snap = dockSnapSide(cursor, bounds, railSpan(size, dockAxis(sideNow.current)), blocked);
      if (dragNow.current?.snap === snap) return;
      const aimed: DragState = { snap };
      dragNow.current = aimed;
      setDrag(aimed);
    },
    [areaRef, stopSettle, x, y],
  );

  const finish = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!pressed.current) return;
      pressed.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      // Панель не сдвинулась: это был клик по ручке, положение остаётся прежним.
      const current = dragNow.current;
      if (!current) return;
      dragNow.current = null;

      const areaElement = areaRef.current;
      if (current.snap) {
        setDock({ kind: 'zone', side: current.snap });
      } else if (areaElement) {
        const box = areaElement.getBoundingClientRect();
        const bounds = { width: box.width, height: box.height };
        const size = railSize.current;
        const ratio = dockRatioFromPoint(point.current, bounds, size);
        const side = dockSideOnAxis(
          centerOf(point.current, size),
          bounds,
          dockAxis(sideNow.current),
        );
        setDock({ kind: 'free', side, x: ratio.x, y: ratio.y });
      }
      setDrag(null);
    },
    [areaRef],
  );

  const moveTo = useCallback((side: DockSide) => setDock({ kind: 'zone', side }), []);

  /** Двойной клик по ручке прижимает панель к ближайшей зоне: удобно после свободного хода. */
  const snapToNearest = useCallback(() => {
    const areaElement = areaRef.current;
    const railElement = railRef.current;
    if (!areaElement || !railElement) return;
    const bounds = { width: areaElement.offsetWidth, height: areaElement.offsetHeight };
    const size = { width: railElement.offsetWidth, height: railElement.offsetHeight };
    setDock({ kind: 'zone', side: dockSideAt(centerOf(point.current, size), bounds) });
  }, [areaRef, railRef]);

  const grip = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      // Если браузер отдал захват кому-то ещё, панель не должна остаться приклеенной к курсору.
      onLostPointerCapture: finish,
      onDoubleClick: snapToNearest,
    }),
    [onPointerDown, onPointerMove, finish, snapToNearest],
  );

  return {
    x,
    y,
    side,
    snap: drag?.snap ?? null,
    dragging: drag !== null,
    ready,
    area,
    rail,
    obstacles,
    grip,
    moveTo,
  };
}
