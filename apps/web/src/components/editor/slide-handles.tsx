'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import type { Grid, SlideIr } from '@lct/contracts';
import {
  gridGuidelines,
  resizedBox,
  slidePixels,
  translatedBox,
  type FrameSize,
  type PixelBox,
} from '@/components/editor/slide-geometry';
import type { ElementMove } from '@/components/editor/use-deck-history';

/** Прилипание срабатывает ближе этого, в экранных пикселях при любом зуме. */
const SNAP_THRESHOLD_PX = 6;
const ALL_SIDES = {
  left: true,
  top: true,
  right: true,
  bottom: true,
  center: true,
  middle: true,
} as const;
/** Отсюда рамка выделения не начинается: это интерфейс поверх холста, а не слайд. */
const CHROME =
  '[data-text-editor], [data-text-format], [data-selection-bar], button, input, [role="toolbar"], [role="group"], [role="menu"]';

/*
 * Вид ручек как в Figma: белые квадраты с обводкой цвета выделения, тонкая рамка. Цвета —
 * токены интерфейса из globals.css, не палитра шаблона. Слой лежит вне трансформа зума,
 * поэтому пиксели здесь экранные при любом масштабе.
 */
const HANDLES_CSS = `
.lct-moveable {
  --moveable-color: var(--canvas-selection);
  --bounds-color: var(--canvas-snap);
}
.lct-moveable .moveable-line {
  background: var(--canvas-selection);
}
.lct-moveable .moveable-control {
  width: 8px;
  height: 8px;
  margin-top: -4px;
  margin-left: -4px;
  border-radius: 1px;
  border: 1px solid var(--canvas-selection);
  background: #fff;
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.08);
  pointer-events: auto;
}
.lct-moveable .moveable-area {
  pointer-events: auto;
}
.lct-moveable .moveable-control {
  z-index: 12;
}
/* Поворот как в Figma: зона сразу за угловой ручкой, на сторонах её нет. */
.lct-moveable .moveable-around-control {
  width: 28px;
  height: 28px;
  margin-top: -14px;
  margin-left: -14px;
  z-index: 1;
  pointer-events: auto;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6.5 15.5a7 7 0 1 0 1.8-9.4' stroke='white' stroke-width='4'/%3E%3Cpath d='M4.5 4.5l3.8 1.6-1.4 3.9' stroke='white' stroke-width='4'/%3E%3Cpath d='M6.5 15.5a7 7 0 1 0 1.8-9.4' stroke='black' stroke-width='1.6'/%3E%3Cpath d='M4.5 4.5l3.8 1.6-1.4 3.9' stroke='black' stroke-width='1.6'/%3E%3C/g%3E%3C/svg%3E") 12 12, alias;
}
.lct-moveable .moveable-around-control:is([data-direction='n'], [data-direction='s'], [data-direction='e'], [data-direction='w']) {
  display: none;
}
.lct-moveable .moveable-control::before {
  content: '';
  position: absolute;
  inset: -5px;
}
.lct-moveable .moveable-guideline:not(.moveable-bounds) {
  background: var(--canvas-snap);
}
.lct-moveable .moveable-guideline.moveable-gap {
  background: var(--canvas-snap);
}
.lct-moveable .moveable-size-value {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--canvas-snap);
  color: #fff;
  font: 500 10px/14px ui-sans-serif, system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lct-moveable .moveable-size-value.moveable-gap {
  color: #fff;
}
`;

const ELEMENT = '[data-element-id]';

function elementsOf(root: HTMLElement, skip?: ReadonlySet<string>): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ELEMENT)].filter(
    (element) => !skip?.has(element.dataset.elementId ?? ''),
  );
}

function elementById(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
}

function sameElements(left: readonly Element[], right: readonly Element[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

function sameRect(left: PixelBox | null, right: PixelBox | null): boolean {
  if (!left || !right) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** Прямоугольник элемента на экране, в пикселях слоя `overlay`. */
function rectIn(overlay: HTMLElement, element: Element): PixelBox {
  const origin = overlay.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Прямоугольник в координатах окна: в них Moveable считает рамку, направляющие и границы. */
function screenRect(element: Element): PixelBox {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/**
 * Пиксели кадра слайда до зума: в них проценты рамок и сдвиги жеста. Дробные, из вычисленного
 * стиля: `offsetWidth` округляет, и перевод в EMU копил бы ошибку.
 */
function frameSize(root: HTMLElement): FrameSize {
  const style = getComputedStyle(root);
  return {
    width: Number.parseFloat(style.width) || root.offsetWidth,
    height: Number.parseFloat(style.height) || root.offsetHeight,
  };
}

function holdRatio(event: {
  inputEvent?: { shiftKey?: boolean };
  target: HTMLElement | SVGElement;
  setRatio: (ratio: number) => void;
}) {
  if (!event.inputEvent?.shiftKey || !(event.target instanceof HTMLElement)) return;
  const { offsetWidth, offsetHeight } = event.target;
  if (offsetWidth > 0 && offsetHeight > 0) event.setRatio(offsetWidth / offsetHeight);
}

function isDoubleOrShift(input: unknown): boolean {
  if (!(input instanceof MouseEvent)) return false;
  return input.detail >= 2 || input.shiftKey;
}

type Numbers = readonly number[];

/**
 * Ручки, рамка выделения и подсветка наведения поверх нарисованного слайда. Всё это живёт в
 * слое `overlay` вне трансформа зума: ручки и полосы одного экранного размера при любом
 * масштабе. Жест доходит до журнала один раз, в конце: новая рамка считается из исходной
 * рамки в EMU и сдвига или размера из событий Moveable, без замера DOM.
 */
export function SlideHandles({
  overlay,
  area,
  slideRoot,
  slide,
  grid,
  selectedIds,
  editingId,
  suspended = false,
  onSelect,
  onCommit,
  onRotate,
  onGestureChange,
}: {
  /** Слой в экранных пикселях поверх холста: здесь ручки и рамка. */
  overlay: HTMLElement;
  /** Видимая область холста: рамку выделения можно начать и за краем слайда. */
  area: HTMLElement;
  /** Кадр открытого слайда: цели ищутся только в нём. */
  slideRoot: HTMLElement;
  slide: SlideIr;
  grid: Grid;
  selectedIds: readonly string[];
  /** Текст, который сейчас набирают: его не выделяют и не таскают. */
  editingId: string | null;
  /** Рука, пробел или вставка: жест принадлежит им, а не выделению. */
  suspended?: boolean;
  onSelect: (ids: readonly string[]) => void;
  onCommit: (moves: readonly ElementMove[]) => void;
  /** Новый угол объекта в конце поворота, в градусах по часовой. */
  onRotate?: (elementId: string, rotation: number) => void;
  /** Рамку тащат или тянут за ручку: с первого сдвига до отпускания. Простой клик сюда не входит. */
  onGestureChange?: (active: boolean) => void;
}) {
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const gesture = useRef(false);
  const pressed = useRef(false);
  const handoff = useRef(0);
  const saved = useRef(
    new Map<HTMLElement | SVGElement, { transform: string; width: string; height: string }>(),
  );
  const [shift, setShift] = useState(false);
  /** Кадр слайда в координатах окна: в них Moveable рисует рамку, направляющие и границы. */
  const [view, setView] = useState<PixelBox | null>(null);
  /** Куда сдвинут слой ручек относительно окна: сцена возвращает его к началу координат окна. */
  const [stage, setStage] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [neighbors, setNeighbors] = useState<HTMLElement[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverRect, setHoverRect] = useState<PixelBox | null>(null);

  // Shift держит пропорции. Отпущенный вне окна Shift иначе «залипал» бы.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShift(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setShift(false);
    };
    const onBlur = () => {
      setShift(false);
      pressed.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Передача жеста от Selecto к Moveable ждёт смены цели; если кнопку уже отпустили, жеста нет.
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (event.button === 0) pressed.current = true;
    };
    const onUp = () => {
      pressed.current = false;
    };
    area.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      area.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [area]);

  const measure = useCallback(() => {
    const next = screenRect(slideRoot);
    const origin = overlay.getBoundingClientRect();
    setView((previous) => (sameRect(previous, next) ? previous : next));
    setStage((previous) =>
      previous.x === origin.left && previous.y === origin.top
        ? previous
        : { x: origin.left, y: origin.top },
    );
    moveableRef.current?.updateRect();
  }, [overlay, slideRoot]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    observer.observe(slideRoot);
    return () => observer.disconnect();
  }, [measure, overlay, slideRoot]);
  // Пан и зум не меняют layout, поэтому ResizeObserver о них молчит.
  useTransformEffect(() => {
    measure();
  });

  // Цели — после коммита: в рендере DOM ещё прежний, и новый объект не нашёлся бы.
  useLayoutEffect(() => {
    const skip = new Set(selectedIds);
    if (editingId) skip.add(editingId);
    const nextTargets = suspended
      ? []
      : selectedIds.flatMap((id) => {
          if (id === editingId) return [];
          const element = elementById(slideRoot, id);
          // Заблокированный объект можно выделить из панели, но не двигать ручками.
          return element && element.dataset.locked !== 'true' ? [element] : [];
        });
    const nextNeighbors = elementsOf(slideRoot, skip);
    setTargets((previous) => (sameElements(previous, nextTargets) ? previous : nextTargets));
    setNeighbors((previous) => (sameElements(previous, nextNeighbors) ? previous : nextNeighbors));
  });

  // У Selecto свой список выделенного: без синхронизации Shift+клик добавлял бы к устаревшему.
  useLayoutEffect(() => {
    selectoRef.current?.setSelectedTargets(targets);
  }, [targets, suspended]);

  useLayoutEffect(() => {
    moveableRef.current?.updateRect();
  }, [slide, targets, view]);

  // Подсветка под курсором: тонкая рамка у невыделенного объекта.
  useEffect(() => {
    if (suspended) return;
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0 || gesture.current) return;
      const hit = event.target instanceof Element ? event.target.closest(ELEMENT) : null;
      const id =
        hit instanceof HTMLElement && slideRoot.contains(hit) && hit.dataset.locked !== 'true'
          ? hit.dataset.elementId
          : undefined;
      setHoverId(id ?? null);
    };
    const onLeave = () => setHoverId(null);
    area.addEventListener('pointermove', onMove);
    area.addEventListener('pointerleave', onLeave);
    return () => {
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      setHoverId(null);
    };
  }, [area, slideRoot, suspended]);

  const hovered =
    hoverId && !suspended && hoverId !== editingId && !selectedIds.includes(hoverId)
      ? hoverId
      : null;
  useLayoutEffect(() => {
    const element = hovered ? elementById(slideRoot, hovered) : null;
    const next = element ? rectIn(overlay, element) : null;
    setHoverRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [hovered, overlay, slideRoot, slide, view]);

  const guides = view
    ? gridGuidelines(grid, view, { x: view.x, y: view.y })
    : { vertical: [], horizontal: [] };
  const byId = new Map(slide.elements.map((element) => [element.elementId, element]));
  // Слайд — граница, поля — только направляющие. Объект, уже вылезший за край, не заталкиваем.
  const onSlide = selectedIds.every((id) => {
    const box = byId.get(id)?.box;
    return (
      !box ||
      (box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.cx <= slide.slideCx &&
        box.y + box.cy <= slide.slideCy)
    );
  });
  const bounds =
    view && onSlide
      ? { left: view.x, top: view.y, right: view.x + view.width, bottom: view.y + view.height }
      : null;

  const remember = (nodes: readonly (HTMLElement | SVGElement)[]) => {
    for (const node of nodes) {
      if (saved.current.has(node)) continue;
      saved.current.set(node, {
        transform: node.style.transform,
        width: node.style.width,
        height: node.style.height,
      });
    }
  };
  // Стили жеста — только на время жеста: дальше рамку снова рисует React из IR.
  const restore = () => {
    for (const [node, style] of saved.current) {
      node.style.transform = style.transform;
      node.style.width = style.width;
      node.style.height = style.height;
    }
    saved.current.clear();
  };

  const begin = () => {
    if (gesture.current) return;
    gesture.current = true;
    setHoverId(null);
    onGestureChange?.(true);
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = false;
    onGestureChange?.(false);
  };

  const commit = (moves: ElementMove[]) => {
    restore();
    flushSync(() => onCommit(moves));
  };

  const commitDrag = (
    items: readonly { target: HTMLElement | SVGElement; translate: Numbers }[],
  ) => {
    const frame = frameSize(slideRoot);
    commit(
      items.flatMap(({ target, translate }) => {
        const id = target instanceof HTMLElement ? target.dataset.elementId : undefined;
        const element = id ? byId.get(id) : undefined;
        if (!id || !element) return [];
        return [
          {
            elementId: id,
            box: translatedBox(element.box, translate, frame, slide.slideCx, slide.slideCy),
          },
        ];
      }),
    );
  };

  const commitResize = (
    items: readonly { target: HTMLElement | SVGElement; last: ResizeLast | undefined }[],
    anchored: boolean,
  ) => {
    const frame = frameSize(slideRoot);
    commit(
      items.flatMap(({ target, last }) => {
        const id = target instanceof HTMLElement ? target.dataset.elementId : undefined;
        const element = id ? byId.get(id) : undefined;
        if (!id || !element || !last) return [];
        const box = resizedBox(
          element.box,
          {
            dist: last.dist ?? [0, 0],
            direction: last.direction ?? [0, 0],
            translate: last.drag?.beforeTranslate ?? [0, 0],
          },
          frame,
          slide.slideCx,
          slide.slideCy,
          anchored,
        );
        return [{ elementId: id, box }];
      }),
    );
  };

  // Заблокированное не выделяется ни щелчком, ни рамкой; прилипать к нему можно.
  const selectable = () =>
    elementsOf(slideRoot, editingId ? new Set([editingId]) : undefined).filter(
      (element) => element.dataset.locked !== 'true',
    );

  return (
    <>
      <style>{HANDLES_CSS}</style>
      {hoverRect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[2] outline outline-1 outline-[var(--canvas-selection)]"
          style={{
            left: hoverRect.x,
            top: hoverRect.y,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      ) : null}
      {/*
       * Сцена ручек. Moveable считает рамку цели в координатах окна, а рисует её в своём
       * контейнере: сцена сдвинута к началу координат окна, и рамка садится ровно на объект.
       * Обрезает её слой холста, так что ручки не выезжают на соседние панели.
       */}
      <div className="absolute size-0" style={{ left: -stage.x, top: -stage.y }}>
        <Moveable
          ref={moveableRef}
          className="lct-moveable"
          target={targets}
          flushSync={flushSync}
          draggable
          resizable
          // Поворот как в Figma: тянуть сразу за угловыми ручками, с Shift — шагом 15°.
          // Группу не вращаем: у SlideIR нет общего центра группы, только углы объектов.
          rotatable={targets.length === 1}
          rotationPosition="none"
          rotateAroundControls
          throttleRotate={shift ? 15 : 0}
          origin={false}
          keepRatio={shift}
          snappable
          snapDirections={ALL_SIDES}
          elementSnapDirections={ALL_SIDES}
          snapThreshold={SNAP_THRESHOLD_PX}
          snapGap
          isDisplaySnapDigit
          isDisplayInnerSnapDigit={false}
          snapDistFormat={(distance) =>
            view ? slidePixels(distance, view.width, slide.slideCx) : Math.round(distance)
          }
          elementGuidelines={neighbors}
          verticalGuidelines={guides.vertical}
          horizontalGuidelines={guides.horizontal}
          bounds={bounds}
          onDragStart={(event) => {
            if (isDoubleOrShift(event.inputEvent)) {
              event.stopDrag();
              return;
            }
            remember([event.target]);
          }}
          onDrag={({ target, transform }) => {
            begin();
            target.style.transform = transform;
          }}
          onDragEnd={(event) => {
            const last = event.lastEvent as { beforeTranslate?: Numbers } | undefined;
            if (event.isDrag && last?.beforeTranslate) {
              commitDrag([{ target: event.target, translate: last.beforeTranslate }]);
            } else restore();
            end();
          }}
          onDragGroupStart={(event) => {
            if (isDoubleOrShift(event.inputEvent)) {
              event.stopDrag();
              return;
            }
            remember(event.targets);
          }}
          onDragGroup={({ events }) => {
            begin();
            for (const item of events) item.target.style.transform = item.transform;
          }}
          onDragGroupEnd={(event) => {
            if (event.isDrag) {
              commitDrag(
                event.events.map((item) => ({
                  target: item.target,
                  translate: (item.lastEvent as { beforeTranslate?: Numbers } | undefined)
                    ?.beforeTranslate ?? [0, 0],
                })),
              );
            } else restore();
            end();
          }}
          onRotateStart={(event) => {
            remember([event.target]);
          }}
          onRotate={({ target, transform }) => {
            begin();
            target.style.transform = transform;
          }}
          onRotateEnd={(event) => {
            const last = event.lastEvent as { rotation?: number } | undefined;
            const id =
              event.target instanceof HTMLElement ? event.target.dataset.elementId : undefined;
            restore();
            if (event.isDrag && id && last?.rotation !== undefined) {
              const rotation = last.rotation;
              flushSync(() => onRotate?.(id, rotation));
            }
            end();
          }}
          onResizeStart={(event) => {
            holdRatio(event);
            event.setMin([1, 1]);
            remember([event.target]);
          }}
          onResize={({ target, width, height, drag }) => {
            begin();
            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.transform = drag.transform;
          }}
          onResizeEnd={(event) => {
            if (event.isDrag) {
              commitResize(
                [{ target: event.target, last: event.lastEvent as ResizeLast | undefined }],
                true,
              );
            } else restore();
            end();
          }}
          onResizeGroupStart={(event) => {
            if ((event.inputEvent as { shiftKey?: boolean } | null)?.shiftKey) {
              for (const item of event.events) holdRatio(item);
            }
            remember(event.targets);
          }}
          onResizeGroup={({ events }) => {
            begin();
            for (const item of events) {
              item.target.style.width = `${item.width}px`;
              item.target.style.height = `${item.height}px`;
              item.target.style.transform = item.drag.transform;
            }
          }}
          onResizeGroupEnd={(event) => {
            if (event.isDrag) {
              commitResize(
                event.events.map((item) => ({
                  target: item.target,
                  last: item.lastEvent as ResizeLast | undefined,
                })),
                false,
              );
            } else restore();
            end();
          }}
        />
      </div>
      {!suspended ? (
        <Selecto
          ref={selectoRef}
          container={overlay}
          rootContainer={overlay}
          dragContainer={area}
          boundContainer={area}
          selectableTargets={[selectable]}
          selectByClick
          selectFromInside={false}
          toggleContinueSelect={['shift']}
          hitRate={0}
          onDragStart={(event) => {
            const input = event.inputEvent as MouseEvent | TouchEvent;
            const pointer = input.target;
            if (!(pointer instanceof Element)) return;
            if (pointer.closest(CHROME)) {
              event.stop();
              return;
            }
            const moveable = moveableRef.current;
            if (moveable?.isMoveableElement(pointer)) {
              event.stop();
              return;
            }
            // Выделенный объект тащит Moveable. С Shift клик по нему снимает его из выделения.
            const hit = pointer.closest(ELEMENT);
            if (hit && targets.includes(hit as HTMLElement) && !input.shiftKey) event.stop();
          }}
          onSelectEnd={(event) => {
            const input = event.inputEvent as MouseEvent | TouchEvent;
            if (input instanceof MouseEvent && input.detail >= 2) return;
            const ids = event.selected.flatMap((element) => {
              const id = element instanceof HTMLElement ? element.dataset.elementId : undefined;
              return id ? [id] : [];
            });
            onSelect(ids);
            // Невыделенный объект тянется с первого жеста: Moveable подхватывает тот же mousedown.
            if (!event.isDragStart || ids.length === 0 || input.shiftKey) return;
            input.preventDefault();
            const token = ++handoff.current;
            moveableRef.current?.waitToChangeTarget().then(() => {
              if (token !== handoff.current || !pressed.current) return;
              moveableRef.current?.dragStart(input);
            });
          }}
        />
      ) : null}
    </>
  );
}

interface ResizeLast {
  readonly dist?: Numbers;
  readonly direction?: Numbers;
  readonly drag?: { readonly beforeTranslate?: Numbers };
}
