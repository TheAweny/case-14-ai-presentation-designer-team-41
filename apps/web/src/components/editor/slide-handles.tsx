'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { useTransformEffect } from 'react-zoom-pan-pinch';
import type { Box, Grid, SlideElement, SlideIr } from '@lct/contracts';
import { EMU_PER_PT } from '@lct/slide-renderer';
import {
  angleBetween,
  boxContains,
  constrainedEnd,
  gridGuidelines,
  lineEnds,
  lineFromEnds,
  resizedBox,
  slidePixels,
  snapValue,
  translatedBox,
  turnedAbout,
  unionBox,
  type FrameSize,
  type PixelBox,
  type Point,
} from '@/components/editor/slide-geometry';
import type { EditMode, ElementMove } from '@/components/editor/use-deck-history';
import { EDITOR_CHROME } from '@/components/editor/chrome-focus';
import { cn } from '@/lib/utils';
import { useEditorPrefs } from '@/components/editor/use-editor-prefs';

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
const CHROME = `[data-text-editor], [data-text-format], [data-selection-bar], [data-line-end], button, input, [role="toolbar"], [role="group"], [role="menu"], ${EDITOR_CHROME}`;

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
/* Линия: вместо рамки и восьми ручек — две ручки на концах. */
.lct-moveable.lct-moveable-line .moveable-line {
  display: none;
}
.lct-line-end {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  border: 1px solid var(--canvas-selection);
  background: #fff;
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.08);
  pointer-events: auto;
  touch-action: none;
  cursor: crosshair;
  z-index: 3001;
}
.lct-line-end::before {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
}
/* Палец: цель ручки не меньше 44 px (WCAG 2.5.8), зона поворота шире. */
@media (pointer: coarse) {
  .lct-moveable .moveable-control::before {
    inset: -18px;
  }
  .lct-moveable .moveable-around-control {
    width: 44px;
    height: 44px;
    margin-top: -22px;
    margin-left: -22px;
  }
  .lct-line-end::before {
    inset: -17px;
  }
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

/** Общий прямоугольник нескольких объектов: рамка группы, как её подсвечивает Figma. */
function unionRect(rects: readonly PixelBox[]): PixelBox | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Рамка объектов с этими id в пикселях слоя `overlay`; `null`, если их нет в кадре. */
function rectOf(overlay: HTMLElement, root: HTMLElement, ids: readonly string[]): PixelBox | null {
  return unionRect(
    ids.flatMap((id) => {
      const element = elementById(root, id);
      return element ? [rectIn(overlay, element)] : [];
    }),
  );
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

/** Второй щелчок двойного: жест отдаётся двойному клику (набор текста, правка таблицы). */
function isDouble(input: unknown): boolean {
  return input instanceof MouseEvent && input.detail >= 2;
}

/** Ctrl или Cmd в начале жеста — выбор сквозь объекты, а не перетаскивание. */
function withMod(input: unknown): boolean {
  return input instanceof MouseEvent && (input.ctrlKey || input.metaKey);
}

function altOf(input: unknown): boolean {
  return (input as { altKey?: boolean } | null | undefined)?.altKey === true;
}

function shiftOf(input: unknown): boolean {
  return (input as { shiftKey?: boolean } | null | undefined)?.shiftKey === true;
}

function idOf(node: unknown): string | undefined {
  return node instanceof HTMLElement ? node.dataset.elementId : undefined;
}

/** Пункты для подписей: в тех же единицах, что поля «Положение» панели «Дизайн». */
function points(emu: number): number {
  return Math.round(emu / EMU_PER_PT);
}

/** Угол для подписи: 0–359°, как его хранит слайд. */
function degrees(rotation: number): number {
  return Math.round(((rotation % 360) + 360) % 360) % 360;
}

function isLine(element: SlideElement | undefined): boolean {
  return element?.kind === 'decor' && element.shape === 'line';
}

type Numbers = readonly number[];

/** Линия после перетаскивания конца: новая рамка и отражения, поворот уже учтён в концах. */
export interface LineReshape {
  readonly box: Box;
  readonly flipH: boolean;
  readonly flipV: boolean;
  /** Ноль, если линия была повёрнута: поворот переходит в положение концов. */
  readonly rotation?: number;
}

/** Объект после поворота выделения вокруг общего центра. */
export interface TurnedElement {
  readonly elementId: string;
  readonly box: Box;
  readonly rotation: number;
}

interface LineDrag {
  readonly elementId: string;
  readonly end: 'from' | 'to';
  readonly from: Point;
  readonly to: Point;
  readonly turned: boolean;
  readonly pointerId: number;
  last: LineReshape | null;
}

/**
 * Ручки, рамка выделения и подсветка наведения поверх нарисованного слайда. Всё это живёт в
 * слое `overlay` вне трансформа зума: ручки и полосы одного экранного размера при любом
 * масштабе. Жест доходит до журнала один раз, в конце: новая рамка считается из исходной
 * рамки в EMU и сдвига или размера из событий Moveable, без замера DOM.
 *
 * Модификаторы как в Figma: Shift держит пропорции (у картинки — наоборот, отпускает), ось
 * перетаскивания и шаг поворота 15°; Alt тянет от центра, а при перетаскивании оставляет
 * оригинал на месте и тащит копию; Ctrl/Cmd во время жеста отключает прилипание, а щелчок с
 * ним выбирает объект под верхним.
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
  onDuplicate,
  onLineEnds,
  onRotateMany,
  onGestureChange,
  hoverUnit,
  highlightIds,
  groupFrame = false,
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
  /**
   * `additive` — щелчок или рамка с Shift: выделение пополняют, а не заменяют. `deep` — выбор
   * сквозь объекты (Ctrl/Cmd+щелчок): берётся сам объект, а не группа, в которой он лежит.
   */
  onSelect: (ids: readonly string[], pick?: SelectPick) => void;
  onCommit: (moves: readonly ElementMove[]) => void;
  /** Новый угол объекта в конце поворота, в градусах по часовой. */
  onRotate?: (elementId: string, rotation: number) => void;
  /** Alt+перетаскивание: копии со сдвигом в EMU, оригиналы на месте. Одна запись журнала. */
  onDuplicate?: (elementIds: readonly string[], offset: Point) => void;
  /**
   * Конец линии перетащили: `preview` на время жеста, `commit` в конце. `null` — жест
   * сорвался, живой вид надо убрать.
   */
  onLineEnds?: (elementId: string, line: LineReshape | null, mode: EditMode) => void;
  /** Несколько объектов повернули вместе: у каждого новая рамка и угол. Одна запись журнала. */
  onRotateMany?: (turns: readonly TurnedElement[]) => void;
  /** Рамку тащат или тянут за ручку: с первого сдвига до отпускания. Простой клик сюда не входит. */
  onGestureChange?: (active: boolean) => void;
  /** Что выберет щелчок по объекту: он сам или вся его группа. Её и подсвечивает наведение. */
  hoverUnit?: (elementId: string) => readonly string[];
  /** Объекты, которые подсвечивает панель слоёв, пока над строкой курсор. */
  highlightIds?: readonly string[];
  /** Выделена одна группа: у неё одна рамка, как в Figma, без рамок каждого объекта. */
  groupFrame?: boolean;
}) {
  const moveableRef = useRef<Moveable>(null);
  const selectoRef = useRef<Selecto>(null);
  const readoutRef = useRef<HTMLDivElement>(null);
  const gesture = useRef(false);
  const pressed = useRef(false);
  const handoff = useRef(0);
  const saved = useRef(
    new Map<HTMLElement | SVGElement, { transform: string; width: string; height: string }>(),
  );
  /** Alt+перетаскивание: слепки оригиналов, которые остаются на месте, пока едет копия. */
  const ghosts = useRef<HTMLElement[]>([]);
  /** Ресайз от центра (Alt) и с пропорциями — как было на последнем шаге жеста. */
  const resizeFlags = useRef({ fromCenter: false, keepRatio: false });
  /** Нажатие внутри выделения на другой объект: без сдвига щелчок выберет его. */
  const pendingSelect = useRef<string | null>(null);
  const lineDrag = useRef<LineDrag | null>(null);
  /** Центр рамки группы в EMU: вокруг него поворачивается несколько объектов. */
  const pivot = useRef<Point | null>(null);
  const [keys, setKeys] = useState({ shift: false, alt: false, mod: false });
  const { snap } = useEditorPrefs();
  /** Рамку тащит Moveable: ручки концов линии на это время прячутся. */
  const [moving, setMoving] = useState(false);
  /** Кадр слайда в координатах окна: в них Moveable рисует рамку, направляющие и границы. */
  const [view, setView] = useState<PixelBox | null>(null);
  /** Куда сдвинут слой ручек относительно окна: сцена возвращает его к началу координат окна. */
  const [stage, setStage] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const [neighbors, setNeighbors] = useState<HTMLElement[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverRect, setHoverRect] = useState<PixelBox | null>(null);

  // Shift и Ctrl/Cmd, пока их держат. Отпущенный вне окна модификатор иначе «залипал» бы.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const next = {
        shift: event.shiftKey,
        alt: event.altKey,
        mod: event.ctrlKey || event.metaKey,
      };
      setKeys((previous) =>
        previous.shift === next.shift && previous.alt === next.alt && previous.mod === next.mod
          ? previous
          : next,
      );
    };
    const onBlur = () => {
      setKeys({ shift: false, alt: false, mod: false });
      pressed.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
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
    // Наведение на объект группы подсвечивает всю группу: щелчок выберет её.
    const unit = hovered ? (hoverUnit?.(hovered) ?? [hovered]) : [];
    const next = rectOf(overlay, slideRoot, unit);
    setHoverRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [hovered, hoverUnit, overlay, slideRoot, slide, view]);

  // Подсветка из панели слоёв и рамки заблокированных объектов, выделенных там же: ручек у
  // них нет, но видно, что выделено.
  const [marks, setMarks] = useState<readonly { key: string; rect: PixelBox; dashed: boolean }[]>(
    [],
  );
  useLayoutEffect(() => {
    const next: { key: string; rect: PixelBox; dashed: boolean }[] = [];
    const lit = rectOf(overlay, slideRoot, suspended ? [] : (highlightIds ?? []));
    if (lit) next.push({ key: 'highlight', rect: lit, dashed: false });
    if (!suspended) {
      for (const id of selectedIds) {
        const element = elementById(slideRoot, id);
        if (element?.dataset.locked !== 'true') continue;
        next.push({ key: id, rect: rectIn(overlay, element), dashed: true });
      }
    }
    setMarks((previous) =>
      previous.length === next.length &&
      previous.every(
        (mark, index) =>
          mark.key === next[index]?.key && sameRect(mark.rect, next[index]?.rect ?? null),
      )
        ? previous
        : next,
    );
  }, [highlightIds, selectedIds, suspended, overlay, slideRoot, slide, view]);

  // Края слайда, поля и колонки — направляющие, а не стены: объект можно вынести за край, как
  // на монтажный стол в Figma или Keynote. Что за краем, в показ и экспорт не попадает.
  const guides = view
    ? gridGuidelines(grid, view, { x: view.x, y: view.y })
    : { vertical: [], horizontal: [] };
  const byId = new Map(slide.elements.map((element) => [element.elementId, element]));
  const only = targets.length === 1 ? byId.get(idOf(targets[0]) ?? '') : undefined;
  const line = only?.kind === 'decor' && isLine(only) ? only : undefined;
  // Картинка по умолчанию держит пропорции, Shift их отпускает — как в Figma и Slides.
  const keepRatio = (only?.kind === 'image') !== keys.shift;

  /** Точка окна в EMU слайда. */
  const toSlide = (clientX: number, clientY: number): Point => {
    const rect = slideRoot.getBoundingClientRect();
    return {
      x: rect.width > 0 ? ((clientX - rect.left) / rect.width) * slide.slideCx : 0,
      y: rect.height > 0 ? ((clientY - rect.top) / rect.height) * slide.slideCy : 0,
    };
  };

  /** Подпись рядом с жестом: размер, угол, длина. Пишется в DOM напрямую, без рендера. */
  const showReadout = (text: string, x: number, y: number) => {
    const node = readoutRef.current;
    if (!node) return;
    node.textContent = text;
    node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translateX(-50%)`;
    node.hidden = false;
  };
  const hideReadout = () => {
    const node = readoutRef.current;
    if (node) node.hidden = true;
  };
  const readoutAtPointer = (text: string, input: unknown) => {
    if (!(input instanceof MouseEvent)) return;
    const origin = overlay.getBoundingClientRect();
    showReadout(text, input.clientX - origin.left, input.clientY - origin.top + 20);
  };

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

  /** Alt при перетаскивании: на месте оригинала остаётся его слепок, едет будущая копия. */
  const showGhosts = (nodes: readonly (HTMLElement | SVGElement)[], on: boolean) => {
    if (!on) {
      for (const ghost of ghosts.current) ghost.remove();
      ghosts.current = [];
      return;
    }
    if (ghosts.current.length > 0) return;
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      const ghost = node.cloneNode(true) as HTMLElement;
      // Слепок — картинка, а не объект: его не находят ни выделение, ни прилипание.
      for (const part of [ghost, ...ghost.querySelectorAll('[data-element-id]')]) {
        part.removeAttribute('data-element-id');
      }
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.transform = saved.current.get(node)?.transform ?? '';
      ghost.style.pointerEvents = 'none';
      node.before(ghost);
      ghosts.current.push(ghost);
    }
  };

  // Стили жеста — только на время жеста: дальше рамку снова рисует React из IR.
  const restore = () => {
    showGhosts([], false);
    for (const [node, style] of saved.current) {
      node.style.transform = style.transform;
      node.style.width = style.width;
      node.style.height = style.height;
    }
    saved.current.clear();
  };

  const begin = (byMoveable = true) => {
    if (gesture.current) return;
    gesture.current = true;
    setHoverId(null);
    if (byMoveable) setMoving(true);
    onGestureChange?.(true);
  };
  const end = () => {
    hideReadout();
    if (!gesture.current) return;
    gesture.current = false;
    setMoving(false);
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
        const id = idOf(target);
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

  /** Alt+перетаскивание: оригиналы на месте, копии там, куда дотащили. */
  const commitCopy = (
    items: readonly { target: HTMLElement | SVGElement; translate: Numbers }[],
  ) => {
    const ids = items.flatMap(({ target }) => {
      const id = idOf(target);
      return id && byId.has(id) ? [id] : [];
    });
    const [dx = 0, dy = 0] = items[0]?.translate ?? [];
    if (!onDuplicate || ids.length === 0) {
      commitDrag(items);
      return;
    }
    const frame = frameSize(slideRoot);
    restore();
    if (frame.width <= 0 || frame.height <= 0) return;
    const offset = {
      x: (dx / frame.width) * slide.slideCx,
      y: (dy / frame.height) * slide.slideCy,
    };
    flushSync(() => onDuplicate(ids, offset));
  };

  const finishDrag = (
    items: readonly { target: HTMLElement | SVGElement; translate: Numbers }[],
    input: unknown,
  ) => {
    if (altOf(input)) commitCopy(items);
    else commitDrag(items);
  };

  /**
   * Щелчок без сдвига. С Shift по выделенному — снять его из выделения. Нажатие пришлось внутри
   * выделения на другой объект — выбрать тот, что сверху.
   */
  const clicked = (input: unknown) => {
    const pending = pendingSelect.current;
    pendingSelect.current = null;
    const target = (input as { target?: unknown } | null)?.target;
    const hit = target instanceof Element ? target.closest(ELEMENT) : null;
    const id = idOf(hit);
    if (shiftOf(input)) {
      // Снимается всё, что выбирал бы этот объект, — у группы вся группа.
      if (id && selectedIds.includes(id)) {
        onSelect(
          selectedIds.filter((item) => item !== id),
          { additive: true },
        );
      }
      return;
    }
    if (pending && !selectedIds.includes(pending)) onSelect([pending]);
  };

  const resizeBox = (
    target: HTMLElement | SVGElement,
    last: ResizeLast | undefined,
    anchored: boolean,
  ): { elementId: string; box: Box } | null => {
    const id = idOf(target);
    const element = id ? byId.get(id) : undefined;
    if (!id || !element || !last) return null;
    const box = resizedBox(
      element.box,
      {
        dist: last.dist ?? [0, 0],
        direction: last.direction ?? [0, 0],
        translate: last.drag?.beforeTranslate ?? [0, 0],
      },
      frameSize(slideRoot),
      slide.slideCx,
      slide.slideCy,
      {
        anchored,
        fromCenter: resizeFlags.current.fromCenter,
        keepRatio: resizeFlags.current.keepRatio,
        rotation: element.rotation ?? 0,
      },
    );
    return { elementId: id, box };
  };

  const commitResize = (
    items: readonly { target: HTMLElement | SVGElement; last: ResizeLast | undefined }[],
    anchored: boolean,
  ) => {
    commit(
      items.flatMap(({ target, last }) => {
        const next = resizeBox(target, last, anchored);
        return next ? [next] : [];
      }),
    );
  };

  /** Ш×В под рамкой во время ресайза, как в Figma: в пунктах, как в панели. */
  const readoutResize = (
    items: readonly { target: HTMLElement | SVGElement; last: ResizeLast }[],
    anchored: boolean,
  ) => {
    const boxes = items.flatMap(({ target, last }) => {
      const next = resizeBox(target, last, anchored);
      return next ? [next.box] : [];
    });
    const bounds = unionBox(boxes);
    if (!bounds) return;
    const rects = items.map(({ target }) => rectIn(overlay, target));
    const left = Math.min(...rects.map((rect) => rect.x));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
    showReadout(`${points(bounds.cx)} × ${points(bounds.cy)}`, (left + right) / 2, bottom + 10);
  };

  /** Наименьшая рамка при ресайзе — строка сетки профиля, но не больше, чем у объекта уже есть. */
  const minSize = (target: HTMLElement | SVGElement): [number, number] => {
    const frame = frameSize(slideRoot);
    const least = slide.slideCy > 0 ? (grid.baseline / slide.slideCy) * frame.height : 1;
    const width = target instanceof HTMLElement ? target.offsetWidth : least;
    const height = target instanceof HTMLElement ? target.offsetHeight : least;
    return [Math.max(1, Math.min(least, width)), Math.max(1, Math.min(least, height))];
  };

  // Заблокированное не выделяется ни щелчком, ни рамкой; прилипать к нему можно.
  const selectable = () =>
    elementsOf(slideRoot, editingId ? new Set([editingId]) : undefined).filter(
      (element) => element.dataset.locked !== 'true',
    );

  /** Объекты под точкой, сверху вниз: их можно выбрать щелчком. */
  const stackAt = (clientX: number, clientY: number): string[] => {
    const ids: string[] = [];
    for (const node of document.elementsFromPoint(clientX, clientY)) {
      const hit = node.closest(ELEMENT);
      const id = idOf(hit);
      if (!id || !(hit instanceof HTMLElement) || !slideRoot.contains(hit)) continue;
      if (hit.dataset.locked === 'true' || id === editingId || ids.includes(id)) continue;
      ids.push(id);
    }
    return ids;
  };

  /**
   * Ctrl/Cmd+щелчок — объект под тем, что выделен сейчас, по кругу: так достаётся перекрытое.
   * Это и глубокое выделение Figma: выбирается сам объект, сквозь группы. Если выделенного под
   * курсором нет, берётся второй сверху — верхний даёт и простой щелчок; а если верхний лежит в
   * группе, простой щелчок дал бы группу, и глубокий начинается с него самого.
   */
  const selectThrough = (clientX: number, clientY: number) => {
    const stack = stackAt(clientX, clientY);
    const [top] = stack;
    if (top === undefined) return;
    const at = selectedIds.length === 1 && selectedIds[0] ? stack.indexOf(selectedIds[0]) : -1;
    const grouped = (hoverUnit?.(top) ?? [top]).length > 1;
    const next = at >= 0 ? stack[(at + 1) % stack.length] : grouped ? top : (stack[1] ?? top);
    if (next) onSelect([next], { additive: false, deep: true });
  };

  /** Точка внутри выделенного объекта, даже если сверху лежит другой. */
  const insideSelection = (clientX: number, clientY: number): boolean => {
    const point = toSlide(clientX, clientY);
    return targets.some((target) => {
      const element = byId.get(idOf(target) ?? '');
      return element !== undefined && boxContains(element.box, point, element.rotation ?? 0);
    });
  };

  /*
   * Концы линии. Ручки стоят в экранных пикселях слоя; тянешь — меняются рамка и отражения,
   * живой вид идёт через журнал (`preview`), запись — одна, в конце.
   */
  const lineHandles = (() => {
    if (!line || !view || moving || suspended) return null;
    const ends = lineEnds(line.box, line, line.rotation ?? 0);
    const scaleX = view.width / slide.slideCx;
    const scaleY = view.height / slide.slideCy;
    const toOverlay = (point: Point) => ({
      x: view.x - stage.x + point.x * scaleX,
      y: view.y - stage.y + point.y * scaleY,
    });
    return { from: toOverlay(ends.from), to: toOverlay(ends.to), ends };
  })();

  /** Куда прилипает конец линии: сетка профиля, края и середины других объектов, другой конец. */
  const lineSnaps = (elementId: string, other: Point) => {
    const lines = gridGuidelines(grid, { width: slide.slideCx, height: slide.slideCy });
    const xs = [...lines.vertical, other.x];
    const ys = [...lines.horizontal, other.y];
    for (const element of slide.elements) {
      if (element.elementId === elementId) continue;
      const { x, y, cx, cy } = element.box;
      xs.push(x, x + cx / 2, x + cx);
      ys.push(y, y + cy / 2, y + cy);
    }
    return { xs, ys };
  };

  const onLineEndDown = (end: 'from' | 'to') => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!line || !lineHandles || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    lineDrag.current = {
      elementId: line.elementId,
      end,
      from: lineHandles.ends.from,
      to: lineHandles.ends.to,
      turned: (line.rotation ?? 0) !== 0,
      pointerId: event.pointerId,
      last: null,
    };
  };

  const onLineEndMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = lineDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    begin(false);
    const other = drag.end === 'from' ? drag.to : drag.from;
    let point = toSlide(event.clientX, event.clientY);
    if (event.shiftKey) {
      point = constrainedEnd(other, point, 45);
    } else if (!(event.ctrlKey || event.metaKey)) {
      const rect = slideRoot.getBoundingClientRect();
      const threshold = rect.width > 0 ? (SNAP_THRESHOLD_PX / rect.width) * slide.slideCx : 0;
      const { xs, ys } = lineSnaps(drag.elementId, other);
      point = { x: snapValue(point.x, xs, threshold), y: snapValue(point.y, ys, threshold) };
    }
    const from = drag.end === 'from' ? point : drag.from;
    const to = drag.end === 'to' ? point : drag.to;
    const shape = lineFromEnds(from, to);
    // Концы сошлись в точку: такой линии не видно, оставляем прежнюю.
    if (shape.box.cx === 0 && shape.box.cy === 0) return;
    const next: LineReshape = drag.turned ? { ...shape, rotation: 0 } : shape;
    drag.last = next;
    onLineEnds?.(drag.elementId, next, 'preview');
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const origin = overlay.getBoundingClientRect();
    showReadout(
      `${points(length)} · ${degrees(angleBetween(from, to))}°`,
      event.clientX - origin.left,
      event.clientY - origin.top + 20,
    );
  };

  const onLineEndUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = lineDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    lineDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const last = drag.last;
    if (event.type === 'pointerup' && last) {
      flushSync(() => onLineEnds?.(drag.elementId, last, 'commit'));
    } else if (last) {
      onLineEnds?.(drag.elementId, null, 'preview');
    }
    end();
  };

  return (
    <>
      <style>{HANDLES_CSS}</style>
      {marks.map((mark) => (
        <div
          key={mark.key}
          aria-hidden
          className={
            mark.dashed
              ? 'pointer-events-none absolute z-[2] outline outline-1 outline-dashed outline-[var(--canvas-selection)]'
              : 'pointer-events-none absolute z-[2] outline outline-2 outline-[var(--canvas-selection)]'
          }
          style={{
            left: mark.rect.x,
            top: mark.rect.y,
            width: mark.rect.width,
            height: mark.rect.height,
          }}
        />
      ))}
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
          className={cn('lct-moveable', line && 'lct-moveable-line')}
          target={targets}
          hideChildMoveableDefaultLines={groupFrame}
          flushSync={flushSync}
          draggable
          // У линии вместо рамки — ручки концов, у остальных восемь ручек.
          resizable={!line}
          // Поворот как в Figma: тянуть сразу за угловыми ручками, с Shift — шагом 15°.
          // Несколько объектов вращаются вокруг центра общей рамки, каждый — со своим углом.
          rotatable={targets.length > 1 ? onRotateMany !== undefined : !line}
          rotationPosition="none"
          rotateAroundControls
          throttleRotate={keys.shift ? 15 : 0}
          // Shift при перетаскивании держит ось: только по горизонтали или по вертикали.
          throttleDragRotate={keys.shift ? 90 : 0}
          origin={false}
          keepRatio={keepRatio}
          // Ctrl/Cmd во время жеста — без прилипания, как в Figma. В настройках его можно
          // выключить совсем.
          snappable={snap && !keys.mod}
          snapDirections={ALL_SIDES}
          elementSnapDirections={ALL_SIDES}
          snapThreshold={SNAP_THRESHOLD_PX}
          snapGap
          // Числа расстояний — по Alt, как в Figma: без него они сыпались между всеми соседями.
          // Линии прилипания и равных промежутков видны всегда.
          isDisplaySnapDigit={keys.alt}
          isDisplayInnerSnapDigit={false}
          snapDistFormat={(distance) =>
            view ? slidePixels(distance, view.width, slide.slideCx) : Math.round(distance)
          }
          elementGuidelines={neighbors}
          verticalGuidelines={guides.vertical}
          horizontalGuidelines={guides.horizontal}
          onDragStart={(event) => {
            if (isDouble(event.inputEvent) || withMod(event.inputEvent)) {
              event.stopDrag();
              return;
            }
            remember([event.target]);
          }}
          onDrag={({ target, transform, inputEvent }) => {
            begin();
            target.style.transform = transform;
            showGhosts([target], altOf(inputEvent));
          }}
          onDragEnd={(event) => {
            const last = event.lastEvent as { beforeTranslate?: Numbers } | undefined;
            if (event.isDrag && last?.beforeTranslate) {
              pendingSelect.current = null;
              finishDrag(
                [{ target: event.target, translate: last.beforeTranslate }],
                event.inputEvent,
              );
            } else {
              restore();
              if (!event.isDrag) clicked(event.inputEvent);
            }
            end();
          }}
          onDragGroupStart={(event) => {
            if (isDouble(event.inputEvent) || withMod(event.inputEvent)) {
              event.stopDrag();
              return;
            }
            remember(event.targets);
          }}
          onDragGroup={({ events, targets: moved, inputEvent }) => {
            begin();
            for (const item of events) item.target.style.transform = item.transform;
            showGhosts(moved, altOf(inputEvent));
          }}
          onDragGroupEnd={(event) => {
            if (event.isDrag) {
              pendingSelect.current = null;
              finishDrag(
                event.events.map((item) => ({
                  target: item.target,
                  translate: (item.lastEvent as { beforeTranslate?: Numbers } | undefined)
                    ?.beforeTranslate ?? [0, 0],
                })),
                event.inputEvent,
              );
            } else {
              restore();
              clicked(event.inputEvent);
            }
            end();
          }}
          onRotateStart={(event) => {
            remember([event.target]);
          }}
          onRotate={({ target, transform, rotation, inputEvent }) => {
            begin();
            target.style.transform = transform;
            readoutAtPointer(`${degrees(rotation)}°`, inputEvent);
          }}
          onRotateEnd={(event) => {
            const last = event.lastEvent as { rotation?: number } | undefined;
            const id = idOf(event.target);
            restore();
            if (event.isDrag && id && last?.rotation !== undefined) {
              const rotation = last.rotation;
              flushSync(() => onRotate?.(id, rotation));
            }
            end();
          }}
          onRotateGroupStart={(event) => {
            remember(event.targets);
            // Центр рамки группы, как её нарисовал Moveable: вокруг него крутится вид. Рамка
            // могла остаться повёрнутой с прошлого раза, поэтому — по её угловым ручкам.
            const box = moveableRef.current?.getControlBoxElement();
            const corners = box
              ? [...box.querySelectorAll('.moveable-control.moveable-direction')]
                  .filter((node) =>
                    ['nw', 'ne', 'sw', 'se'].includes(node.getAttribute('data-direction') ?? ''),
                  )
                  .map((node) => node.getBoundingClientRect())
              : [];
            if (corners.length !== 4) {
              pivot.current = null;
              return;
            }
            const x = corners.reduce((sum, rect) => sum + rect.left + rect.width / 2, 0) / 4;
            const y = corners.reduce((sum, rect) => sum + rect.top + rect.height / 2, 0) / 4;
            pivot.current = toSlide(x, y);
          }}
          onRotateGroup={({ events, dist, inputEvent }) => {
            begin();
            // Каждый объект и поворачивается, и обходит центр группы: это `drag.transform`.
            for (const item of events) item.target.style.transform = item.drag.transform;
            readoutAtPointer(`${degrees(dist)}°`, inputEvent);
          }}
          onRotateGroupEnd={(event) => {
            const last = event.lastEvent as { dist?: number } | undefined;
            const center = pivot.current;
            pivot.current = null;
            restore();
            if (event.isDrag && center && last?.dist !== undefined && last.dist !== 0) {
              const delta = last.dist;
              const turns = event.targets.flatMap((target) => {
                const id = idOf(target);
                const element = id ? byId.get(id) : undefined;
                if (!id || !element) return [];
                const next = turnedAbout(element.box, element.rotation ?? 0, center, delta);
                return [{ elementId: id, ...next }];
              });
              flushSync(() => onRotateMany?.(turns));
            }
            end();
          }}
          onResizeStart={(event) => {
            holdRatio(event);
            event.setMin(minSize(event.target));
            remember([event.target]);
            resizeFlags.current = { fromCenter: false, keepRatio: false };
          }}
          // Alt/Option — от центра: неподвижна середина, а не противоположная сторона.
          onBeforeResize={(event) => {
            const fromCenter = altOf(event.inputEvent);
            if (fromCenter === resizeFlags.current.fromCenter) return;
            resizeFlags.current = { ...resizeFlags.current, fromCenter };
            event.setFixedDirection(fromCenter ? [0, 0] : event.startFixedDirection);
          }}
          onResize={({ target, width, height, drag, dist, direction, inputEvent }) => {
            begin();
            target.style.width = `${width}px`;
            target.style.height = `${height}px`;
            target.style.transform = drag.transform;
            const image = target instanceof HTMLElement && target.dataset.kind === 'image';
            resizeFlags.current = {
              ...resizeFlags.current,
              keepRatio: image !== shiftOf(inputEvent),
            };
            readoutResize([{ target, last: { dist, direction, drag } }], true);
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
            resizeFlags.current = { fromCenter: false, keepRatio: false };
          }}
          onBeforeResizeGroup={(event) => {
            const fromCenter = altOf(event.inputEvent);
            if (fromCenter === resizeFlags.current.fromCenter) return;
            resizeFlags.current = { ...resizeFlags.current, fromCenter };
            event.setFixedDirection(fromCenter ? [0, 0] : event.startFixedDirection);
          }}
          onResizeGroup={({ events, inputEvent }) => {
            begin();
            for (const item of events) {
              item.target.style.width = `${item.width}px`;
              item.target.style.height = `${item.height}px`;
              item.target.style.transform = item.drag.transform;
            }
            resizeFlags.current = { ...resizeFlags.current, keepRatio: shiftOf(inputEvent) };
            readoutResize(
              events.map((item) => ({
                target: item.target,
                last: { dist: item.dist, direction: item.direction, drag: item.drag },
              })),
              false,
            );
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
      {lineHandles ? (
        <>
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            <line
              x1={lineHandles.from.x}
              y1={lineHandles.from.y}
              x2={lineHandles.to.x}
              y2={lineHandles.to.y}
              stroke="var(--canvas-selection)"
              strokeWidth={1}
            />
          </svg>
          {(['from', 'to'] as const).map((end) => (
            <div
              key={end}
              aria-hidden
              data-line-end={end}
              className="lct-line-end"
              style={{ left: lineHandles[end].x, top: lineHandles[end].y }}
              onPointerDown={onLineEndDown(end)}
              onPointerMove={onLineEndMove}
              onPointerUp={onLineEndUp}
              onPointerCancel={onLineEndUp}
              onLostPointerCapture={onLineEndUp}
            />
          ))}
        </>
      ) : null}
      <div
        ref={readoutRef}
        aria-hidden
        hidden
        className="pointer-events-none absolute top-0 left-0 z-[3002] rounded bg-[var(--canvas-selection)] px-1.5 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white tabular-nums shadow-sm"
      />
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
            pendingSelect.current = null;
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
            // Ctrl/Cmd+щелчок — выбор сквозь объекты: перекрытое достаётся без панели слоёв.
            if (input instanceof MouseEvent && withMod(input)) {
              event.stop();
              if (slideRoot.contains(pointer)) selectThrough(input.clientX, input.clientY);
              return;
            }
            // Выделенный объект тащит Moveable, в том числе с Shift: Shift держит ось, а
            // Shift+щелчок без сдвига снимает объект из выделения (см. `clicked`).
            const hit = pointer.closest(ELEMENT);
            if (hit && targets.includes(hit as HTMLElement)) {
              event.stop();
              return;
            }
            // Нажатие внутри выделения, но на другом объекте сверху: тянется выделение, как в
            // Figma; щелчок без сдвига выберет верхний объект.
            if (
              input instanceof MouseEvent &&
              !input.shiftKey &&
              targets.length > 0 &&
              insideSelection(input.clientX, input.clientY)
            ) {
              event.stop();
              const top = idOf(hit);
              pendingSelect.current =
                top && hit instanceof HTMLElement && hit.dataset.locked !== 'true' ? top : null;
              moveable?.dragStart(input);
            }
          }}
          onSelectEnd={(event) => {
            const input = event.inputEvent as MouseEvent | TouchEvent;
            if (input instanceof MouseEvent && input.detail >= 2) return;
            const ids = event.selected.flatMap((element) => {
              const id = idOf(element);
              return id ? [id] : [];
            });
            onSelect(ids, { additive: input.shiftKey });
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

/** Как выбирали: с Shift пополняют выделение, сквозь объекты — берут сам объект. */
export interface SelectPick {
  readonly additive: boolean;
  readonly deep?: boolean;
}

interface ResizeLast {
  readonly dist?: Numbers;
  readonly direction?: Numbers;
  readonly drag?: { readonly beforeTranslate?: Numbers };
}
