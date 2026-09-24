'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch';
import type {
  Box,
  ColorRole,
  DesignSystem,
  Paragraph,
  SlideElement,
  SlideIr,
} from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import type { TableCell } from '@lct/deck-ops';
import { FitSlide, ZoomBasis, ZoomHud } from '@/components/editor/canvas-zoom';
import { zoomScaleFor } from '@/components/editor/zoom-input';
import {
  CanvasViewContext,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  transformToFit,
  type CanvasView,
} from '@/components/editor/canvas-viewport';
import { useCanvasNavigation, zoomCanvasAt } from '@/components/editor/use-canvas-navigation';
import {
  createImageElement,
  createInsertedElements,
  isInsertTool,
  type InsertTool,
} from '@/components/editor/insert-element';
import { SelectionBar } from '@/components/editor/selection-bar';
import { SlideHandles } from '@/components/editor/slide-handles';
import { TextEditor } from '@/components/editor/text-editor';
import { TableEditor, type GridCell } from '@/components/editor/table-editor';
import {
  arrowDirection,
  gridForSlide,
  nudgeBox,
  pixelBoxToEmu,
  type Alignment,
} from '@/components/editor/slide-geometry';
import { isTypingTarget } from '@/components/editor/slide-navigation';
import type { VariantId } from '@/components/editor/tool-rail';
import type { ElementMove } from '@/components/editor/use-deck-history';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { CanvasMenuContent } from '@/components/editor/canvas-menu';
import type { CanvasCommand } from '@/components/editor/editor-keymap';
import { carriesFiles, imageFilesOf, pickImageFiles, registerImage } from '@/lib/image-files';

/** Здесь стрелки — свои клавиши виджета, а не сдвиг объекта. */
const ARROW_OWNERS =
  '[role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="slider"], [role="tablist"]';
/** Отсюда протяжка вставки не начинается: это интерфейс поверх холста, а не поле. */
const INSERT_SKIPS =
  '[data-text-editor], [data-selection-bar], [data-text-format], [data-dock-obstacle], button, [role="menu"]';
/** Клик сюда не закрывает набор: это само поле, его полоса и кнопки поверх холста. */
const KEEPS_EDITING =
  '[data-text-editor], [data-text-format], [data-table-editor], button, [role="group"]';
/** Здесь фокус свой: набор текста, его полоса и ячейки таблицы. Холст его не отбирает. */
const OWNS_FOCUS = '[data-text-editor], [data-text-format], [data-table-editor]';

/**
 * Поле вокруг слайда приглушено: вынесенное за край видно, но читается как «не на слайде».
 * Тень-подложка выходит за слайд на весь холст даже при самом мелком зуме.
 */
const PASTEBOARD_VEIL = `0 0 0 1px var(--border), 0 0 0 ${Math.ceil(100 / MIN_CANVAS_SCALE)}vmax color-mix(in oklab, var(--background) 62%, transparent)`;

/**
 * Что редактор может попросить у холста с клавиатуры: Enter открывает набор (как двойной
 * клик), переход между слайдами возвращает фокус на холст.
 */
export interface CanvasControl {
  /** Открыть набор текста или правку таблицы у объекта. `false` — у объекта такого нет. */
  startEditing(elementId: string): boolean;
  /** Фокус на холст: клавиши снова у слайда, а не у кнопки или списка. */
  focus(): void;
}

/**
 * Холст: открытый слайд, вписанный в доступную область целиком, без искажений.
 *
 * Область — контейнер размеров, и ширина слайда — меньшая из двух: вся ширина области или её
 * высота, умноженная на пропорцию слайда. Пропорция берётся из самого слайда, поэтому
 * одинаково вписываются и 16:9, и 4:3, и портретный шаблон, при любом размере окна.
 *
 * Слайд лежит внутри трансформа зума, а ручки, рамка выделения и полоса свойств — в экранном
 * слое над ним: их пиксели не масштабируются вместе со слайдом.
 */
/** В тексте нет ничего, кроме пробелов: такой рамке на слайде не место. */
function isBlank(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text.trim() === ''));
}

export function SlideCanvas({
  slide,
  designSystem,
  label,
  resolveMedia,
  selectedIds,
  tool,
  onSelect,
  onCommit,
  onTextCommit,
  onRemove,
  onRemoveElements,
  onAlign,
  onInsert,
  onFontSize,
  onColor,
  onReplaceImage,
  onCommand,
  canPaste,
  hasLocked,
  onTableCell,
  onRotate,
  controlRef,
  className,
}: {
  slide: SlideIr;
  designSystem: DesignSystem;
  /** Что на слайде, для чтения с экрана. */
  label: string;
  /** Адрес картинки по `mediaPart`. Нет адреса — рамка. */
  resolveMedia?: (mediaPart: string) => string | null;
  selectedIds: readonly string[];
  /** Инструмент рейки. Рука панорамирует уже вписанный лист, остальные жесты остаются у выбора. */
  tool: VariantId;
  onSelect: (ids: readonly string[]) => void;
  /** Конец жеста: один список новых рамок, не шаг на каждый пиксель. */
  onCommit: (moves: readonly ElementMove[]) => void;
  /** Закрытие набора: один `set-text`, не шаг на каждый символ. */
  onTextCommit: (slideId: string, elementId: string, paragraphs: readonly Paragraph[]) => void;
  /** Удалить выделенное. */
  onRemove: () => void;
  /** Удалить эти объекты, выделены они или нет: пустой текст после набора. */
  onRemoveElements: (elementIds: readonly string[]) => void;
  /** Выровнять выделенные объекты между собой. */
  onAlign: (alignment: Alignment) => void;
  /** Новый объект. В журнал он попадает целиком, одним шагом. */
  onInsert: (elements: readonly SlideElement[]) => void;
  onFontSize: (elementId: string, sizePt: number) => void;
  onColor: (elementId: string, colorRole: ColorRole, hex: string) => void;
  /** Новый файл в рамке картинки: рамка и вписывание остаются, меняется только `mediaPart`. */
  onReplaceImage: (elementId: string, mediaPart: string) => void;
  /** Команда из контекстного меню холста. */
  onCommand: (command: CanvasCommand) => void;
  /** Есть ли что вставить из меню: скопированное в этой вкладке. */
  canPaste: boolean;
  /** На слайде есть заблокированные объекты: меню предлагает их разблокировать. */
  hasLocked: boolean;
  /** Текст ячейки таблицы: одна запись журнала на ячейку. */
  onTableCell: (elementId: string, cell: TableCell, text: string) => void;
  /** Угол объекта после поворота ручкой. */
  onRotate: (elementId: string, rotation: number) => void;
  /** Сюда холст кладёт то, что умеет по просьбе клавиатуры: см. `CanvasControl`. */
  controlRef?: { current: CanvasControl | null };
  className?: string;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const rememberHost = useCallback((node: HTMLDivElement | null) => setHost(node), []);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const rememberArea = useCallback((node: HTMLDivElement | null) => setArea(node), []);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const rememberOverlay = useCallback((node: HTMLDivElement | null) => setOverlay(node), []);
  // Кадр слайда, который отрисовал SlideView. Слайд один: смена слайда мгновенная, как в
  // Figma, и уходящий лист не остаётся в DOM рядом с новым.
  const [slideRoot, setSlideRoot] = useState<HTMLElement | null>(null);
  const rememberSlide = useCallback((node: HTMLDivElement | null) => {
    setSlideRoot(node?.querySelector<HTMLElement>('[data-slide-root]') ?? null);
  }, []);
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const finishEditing = useRef<(() => void) | null>(null);
  const [gesture, setGesture] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const inserting = isInsertTool(tool);
  // Точка, куда встанет каретка. Без точки (вход с клавиатуры) выделяется весь текст.
  const [session, setSession] = useState<{
    slideId: string;
    elementId: string;
    x: number | null;
    y: number | null;
  } | null>(null);
  const aligned = useMemo(
    () => gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy),
    [designSystem.grid, slide.slideCx, slide.slideCy],
  );
  const editing =
    session?.slideId === slide.slideId
      ? slide.elements.find((item) => item.elementId === session.elementId && item.kind === 'text')
      : undefined;
  const editingId = editing?.kind === 'text' ? editing.elementId : null;
  const committedText = useRef<readonly Paragraph[] | null>(null);
  // Правка таблицы по двойному клику: таблица остаётся выделенной, чтобы в панели были
  // строки и столбцы, а ручки на это время прячутся.
  const [tableSession, setTableSession] = useState<{
    slideId: string;
    elementId: string;
    focus: GridCell;
  } | null>(null);
  const finishTable = useRef<(() => void) | null>(null);
  const editingTable =
    tableSession?.slideId === slide.slideId
      ? slide.elements.find(
          (item) => item.elementId === tableSession.elementId && item.kind === 'table',
        )
      : undefined;

  // Клавиши и команды зума читают текущее, не пересоздавая слушателей на каждую правку.
  const latest = useRef({ slide, selectedIds, aligned, onCommit });
  useEffect(() => {
    latest.current = { slide, selectedIds, aligned, onCommit };
  });

  useEffect(() => {
    setSession(null);
    setTableSession(null);
    setGesture(false);
  }, [slide.slideId]);

  // Выделение сменилось, пока открыт набор: набор закрывается и уходит в журнал.
  useEffect(() => {
    if (selectedIds.length > 0) finishEditing.current?.();
    const table = tableSession?.elementId;
    if (table && !(selectedIds.length === 1 && selectedIds[0] === table)) {
      finishTable.current?.();
    }
  }, [selectedIds, tableSession]);

  // Клик по холсту мимо поля закрывает набор. Mousedown у Selecto фокус не отдаёт, так что
  // на blur тут надеяться нельзя.
  useEffect(() => {
    if (!area || (!session && !tableSession)) return;
    const onDown = (event: PointerEvent) => {
      // Средняя кнопка тащит холст: набор при этом не закрывается.
      if (event.button === 1) return;
      const target = event.target;
      if (target instanceof Element && target.closest(KEEPS_EDITING)) return;
      finishEditing.current?.();
      finishTable.current?.();
    };
    area.addEventListener('pointerdown', onDown, true);
    return () => area.removeEventListener('pointerdown', onDown, true);
  }, [area, session, tableSession]);

  // Щелчок по холсту забирает клавиатуру у списка слайдов и кнопок, как в Figma и Slides:
  // Delete, стрелки и пробел дальше про холст, а не про миниатюру. Сам браузер фокус сюда не
  // перенесёт — Selecto и Moveable гасят mousedown. Поле, набор и ячейка фокус берут сами,
  // а открытый набор его не теряет: закрывает набор обработчик выше.
  useEffect(() => {
    if (!area) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (isTypingTarget(target)) return;
      if (target instanceof Element && target.closest(OWNS_FOCUS)) return;
      const active = document.activeElement;
      if (active === area) return;
      if (
        active instanceof Element &&
        area.contains(active) &&
        (isTypingTarget(active) || active.closest(OWNS_FOCUS))
      ) {
        return;
      }
      area.focus({ preventScroll: true });
    };
    area.addEventListener('pointerdown', onDown, true);
    return () => area.removeEventListener('pointerdown', onDown, true);
  }, [area]);

  useEffect(() => {
    if (!host) return;
    const measure = () => setFitWidth(host.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  const actualScale = zoomScaleFor(1, fitWidth, slide.slideCx);

  /**
   * Картинки с диска, из перетаскивания или из буфера. Несколько файлов ложатся лесенкой, чтобы
   * не закрывать друг друга, и все вместе — одним шагом истории.
   */
  const insertImages = useCallback(
    async (drag: Box, given?: readonly File[]) => {
      const files = given ?? (await pickImageFiles({ multiple: true }));
      if (files.length === 0) return;
      const step = Math.max(1, aligned.baseline * 4);
      const elements: SlideElement[] = [];
      for (const [index, file] of files.entries()) {
        const { mediaPart, size } = await registerImage(file);
        const shifted = { ...drag, x: drag.x + index * step, y: drag.y + index * step };
        elements.push(
          createImageElement(mediaPart, shifted, aligned, size, { profile: designSystem }),
        );
      }
      onInsert(elements);
      onSelect(elements.map((element) => element.elementId));
    },
    [aligned, designSystem, onInsert, onSelect],
  );

  /** Другой файл в той же рамке: положение, размер и вписывание остаются. */
  const replaceImage = useCallback(
    async (elementId: string) => {
      const [file] = await pickImageFiles();
      if (!file) return;
      const { mediaPart } = await registerImage(file);
      onReplaceImage(elementId, mediaPart);
    },
    [onReplaceImage],
  );

  // Файл, брошенный на холст, ложится туда, куда его бросили; вставка из буфера — в центр слайда.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!area) return;
    let depth = 0;
    const pointOnSlide = (clientX: number, clientY: number): Box => {
      const current = latest.current.slide;
      const rect = slideRoot?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return {
          x: Math.round(current.slideCx / 2),
          y: Math.round(current.slideCy / 2),
          cx: 0,
          cy: 0,
        };
      }
      // Брошенное на поле вокруг слайда ложится там же, за краем: это место для композиции.
      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      return {
        x: Math.round(fx * current.slideCx),
        y: Math.round(fy * current.slideCy),
        cx: 0,
        cy: 0,
      };
    };
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      setDropping(true);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth = 0;
      setDropping(false);
      const files = imageFilesOf(event.dataTransfer);
      if (files.length > 0) void insertImages(pointOnSlide(event.clientX, event.clientY), files);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const files = imageFilesOf(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      const current = latest.current.slide;
      void insertImages(
        { x: Math.round(current.slideCx / 2), y: Math.round(current.slideCy / 2), cx: 0, cy: 0 },
        files,
      );
    };
    area.addEventListener('dragenter', onEnter);
    area.addEventListener('dragover', onOver);
    area.addEventListener('dragleave', onLeave);
    area.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      area.removeEventListener('dragenter', onEnter);
      area.removeEventListener('dragover', onOver);
      area.removeEventListener('dragleave', onLeave);
      area.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [area, insertImages, slideRoot]);

  const view = useMemo<CanvasView>(() => {
    const api = () => transformRef.current;
    const center = () => {
      const wrapper = api()?.instance.wrapperComponent?.getBoundingClientRect();
      return wrapper
        ? { x: wrapper.left + wrapper.width / 2, y: wrapper.top + wrapper.height / 2 }
        : null;
    };
    const zoomAtCenter = (scale: number) => {
      const point = center();
      const controls = api();
      if (point && controls) zoomCanvasAt(controls, point.x, point.y, scale);
    };
    const zoomToFit = () => void api()?.centerView(1, 0);
    return {
      actualScale,
      zoomToFit,
      zoomToActual: () => zoomAtCenter(actualScale),
      zoomBy: (factor) => {
        const current = api()?.instance.state.scale;
        if (current) zoomAtCenter(current * factor);
      },
      zoomToSelection: () => {
        const controls = api();
        const wrapper = controls?.instance.wrapperComponent;
        const { selectedIds: ids } = latest.current;
        if (!controls || !wrapper || !slideRoot || ids.length === 0) {
          zoomToFit();
          return;
        }
        const rects = ids.flatMap((id) => {
          const node = slideRoot.querySelector(`[data-element-id="${CSS.escape(id)}"]`);
          return node ? [node.getBoundingClientRect()] : [];
        });
        if (rects.length === 0) return;
        const left = Math.min(...rects.map((rect) => rect.left));
        const top = Math.min(...rects.map((rect) => rect.top));
        const right = Math.max(...rects.map((rect) => rect.right));
        const bottom = Math.max(...rects.map((rect) => rect.bottom));
        const box = wrapper.getBoundingClientRect();
        const next = transformToFit(
          { left, top, width: right - left, height: bottom - top },
          { left: box.left, top: box.top, width: box.width, height: box.height },
          controls.instance.state,
        );
        if (!next) return;
        void controls.setTransform(next.positionX, next.positionY, next.scale, 0);
      },
    };
  }, [actualScale, slideRoot]);

  const handTool = tool === 'hand';
  // Пан (средняя кнопка, рука, пробел), колесо и клавиши зума.
  const { spacePan, panning } = useCanvasNavigation({
    area,
    slideRoot,
    transformRef,
    handTool,
    view,
  });
  const pan = handTool || spacePan;

  // Стрелка сдвигает выделенное ровно в свою сторону: шаг — baseline сетки, с Shift — крупный.
  // Слушатель стоит на погружении: он раньше общих клавиш редактора, и `preventDefault`
  // говорит им, что стрелка уже отработана.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const direction = arrowDirection(event.code);
      if (!direction || isTypingTarget(event.target)) return;
      const target = event.target;
      if (target instanceof Element && target.closest(ARROW_OWNERS)) return;
      const { slide: current, selectedIds: ids, aligned: grid, onCommit: commit } = latest.current;
      if (ids.length === 0) return;
      event.preventDefault();
      commit(
        ids.flatMap((elementId) => {
          const element = current.elements.find((item) => item.elementId === elementId);
          if (!element) return [];
          return [{ elementId, box: nudgeBox(element.box, direction, grid, event.shiftKey) }];
        }),
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Протяжка вставки начинается и на поле вокруг слайда: объект можно положить за край.
  useEffect(() => {
    if (!host || !area || pan || !isInsertTool(tool)) return;
    const active: InsertTool = tool;
    let start: { x: number; y: number } | null = null;
    let box: { x: number; y: number; width: number; height: number } | null = null;
    let pointer = -1;

    const toLayout = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const scaleX = host.offsetWidth / (rect.width || 1);
      const scaleY = host.offsetHeight / (rect.height || 1);
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
      };
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.detail >= 2) return;
      const target = event.target;
      if (!(target instanceof Element) || !area.contains(target)) return;
      if (target.closest(INSERT_SKIPS)) return;
      event.preventDefault();
      pointer = event.pointerId;
      area.setPointerCapture(pointer);
      start = toLayout(event);
      box = { x: start.x, y: start.y, width: 0, height: 0 };
      setDraft(box);
    };
    const onMove = (event: PointerEvent) => {
      if (!start || event.pointerId !== pointer) return;
      const point = toLayout(event);
      box = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
      setDraft(box);
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointer || !box) return;
      pointer = -1;
      const placed = box;
      // Куда шла протяжка: линия и стрелка сохраняют направление (D29).
      const end = toLayout(event);
      const reversedX = start !== null && end.x < start.x;
      const reversedY = start !== null && end.y < start.y;
      start = null;
      box = null;
      setDraft(null);
      if (area.hasPointerCapture(event.pointerId)) area.releasePointerCapture(event.pointerId);
      const rect = host.getBoundingClientRect();
      const scaleX = rect.width / (host.offsetWidth || 1);
      const scaleY = rect.height / (host.offsetHeight || 1);
      const drag = pixelBoxToEmu(
        {
          x: placed.x * scaleX,
          y: placed.y * scaleY,
          width: placed.width * scaleX,
          height: placed.height * scaleY,
        },
        { width: rect.width, height: rect.height },
        slide.slideCx,
        slide.slideCy,
      );
      if (active === 'image') {
        // Сначала файл, потом рамка: отмена выбора не оставляет на слайде пустого места.
        void insertImages(drag);
        return;
      }
      const elements = createInsertedElements(active, drag, aligned, {
        profile: designSystem,
        reversedX,
        reversedY,
      });
      if (elements.length === 0) return;
      onInsert(elements);
      const text = elements.find((element) => element.kind === 'text');
      if (text) {
        onSelect([]);
        setSession({
          slideId: slide.slideId,
          elementId: text.elementId,
          x: event.clientX,
          y: event.clientY,
        });
      } else {
        onSelect(elements.map((element) => element.elementId));
      }
    };

    const cancel = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = -1;
      start = null;
      box = null;
      setDraft(null);
    };
    area.addEventListener('pointerdown', onDown);
    area.addEventListener('pointermove', onMove);
    area.addEventListener('pointerup', finish);
    area.addEventListener('pointercancel', cancel);
    return () => {
      area.removeEventListener('pointerdown', onDown);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerup', finish);
      area.removeEventListener('pointercancel', cancel);
    };
  }, [aligned, area, designSystem, host, insertImages, onInsert, onSelect, pan, slide, tool]);

  useEffect(() => {
    if (!host) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (tool === 'hand' || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element) || !host.contains(target)) return;
      if (target.closest('[data-text-editor]')) return;
      const picture = target.closest('[data-kind="image"]');
      if (picture instanceof HTMLElement && picture.dataset.elementId) {
        event.preventDefault();
        void replaceImage(picture.dataset.elementId);
        return;
      }
      const table = target.closest('[data-kind="table"]');
      if (table instanceof HTMLElement && table.dataset.elementId) {
        const cell = target.closest('td');
        const row =
          cell?.parentElement instanceof HTMLTableRowElement ? cell.parentElement.rowIndex : 0;
        event.preventDefault();
        onSelect([table.dataset.elementId]);
        setTableSession({
          slideId: slide.slideId,
          elementId: table.dataset.elementId,
          focus: { row: Math.max(0, row), column: Math.max(0, cell?.cellIndex ?? 0) },
        });
        return;
      }
      const hit = target.closest('[data-kind="text"]');
      if (!(hit instanceof HTMLElement)) return;
      const elementId = hit.dataset.elementId;
      if (!elementId) return;
      const element = slide.elements.find((item) => item.elementId === elementId);
      if (!element || element.kind !== 'text') return;
      event.preventDefault();
      onSelect([]);
      setSession({ slideId: slide.slideId, elementId, x: event.clientX, y: event.clientY });
    };
    host.addEventListener('dblclick', onDoubleClick);
    return () => host.removeEventListener('dblclick', onDoubleClick);
  }, [host, onSelect, replaceImage, slide, tool]);

  // Двойной клик по пустому полю вокруг слайда возвращает слайд в кадр.
  useEffect(() => {
    if (!area || !slideRoot) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || isInsertTool(tool)) return;
      const target = event.target;
      if (!(target instanceof Element) || slideRoot.contains(target)) return;
      if (target.closest(INSERT_SKIPS)) return;
      event.preventDefault();
      view.zoomToFit();
    };
    area.addEventListener('dblclick', onDoubleClick);
    return () => area.removeEventListener('dblclick', onDoubleClick);
  }, [area, slideRoot, tool, view]);

  // Enter на выделенном объекте — тот же вход, что и двойной клик: текст открывает набор,
  // таблица — правку ячеек с первой.
  useEffect(() => {
    if (!controlRef) return;
    const control: CanvasControl = {
      startEditing: (elementId) => {
        const element = slide.elements.find((item) => item.elementId === elementId);
        if (!element || element.locked) return false;
        if (element.kind === 'text') {
          onSelect([]);
          setSession({ slideId: slide.slideId, elementId, x: null, y: null });
          return true;
        }
        if (element.kind === 'table') {
          onSelect([elementId]);
          setTableSession({ slideId: slide.slideId, elementId, focus: { row: 0, column: 0 } });
          return true;
        }
        return false;
      },
      focus: () => area?.focus({ preventScroll: true }),
    };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) controlRef.current = null;
    };
  }, [area, controlRef, onSelect, slide]);

  const selectUnderPointer = (event: ReactMouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !slideRoot?.contains(target)) {
      if (target instanceof Element && target.closest('[data-selection-bar]')) return;
      onSelect([]);
      return;
    }
    const hit = target.closest<HTMLElement>('[data-element-id]');
    const id = hit?.dataset.elementId;
    if (!id || hit?.dataset.locked === 'true') {
      onSelect([]);
      return;
    }
    if (!selectedIds.includes(id)) onSelect([id]);
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild disabled={session !== null || tableSession !== null || pan}>
        <div
          ref={rememberArea}
          // Фокус сюда ставят щелчок по холсту и переход между слайдами с клавиатуры; сам в
          // порядок Tab не входит.
          tabIndex={-1}
          data-canvas-area=""
          onContextMenu={selectUnderPointer}
          className={cn(
            'relative size-full overflow-hidden outline-none',
            // Рука и пробел: курсор руки поверх всего, что на холсте, включая ручки.
            panning
              ? 'cursor-grabbing [&_*]:cursor-grabbing!'
              : pan
                ? 'cursor-grab touch-none [&_*]:cursor-grab!'
                : inserting && 'cursor-crosshair touch-none',
          )}
        >
          {/*
           * Лист уже вписан в область контейнером размеров. Библиотека масштабирует этот вписанный
           * лист: единица — это «вписать». Панорама, колесо и клавиши — в `useCanvasNavigation`:
           * она же держит вид на поле вокруг слайда, поэтому границы библиотеки выключены.
           * Отступы области — внутри трансформа: вынесенное за край слайда видно до самых краёв
           * холста, а не обрезается рамкой отступов.
           */}
          <TransformWrapper
            ref={transformRef}
            minScale={MIN_CANVAS_SCALE}
            maxScale={MAX_CANVAS_SCALE}
            centerOnInit
            limitToBounds={false}
            disablePadding
            doubleClick={{ disabled: true }}
            keyboard={{ disabled: true }}
            autoAlignment={{ disabled: true }}
            velocityAnimation={{ disabled: true }}
            zoomAnimation={{ disabled: true }}
            wheel={{ disabled: true }}
            trackPadPanning={{ disabled: true }}
            panning={{ disabled: true }}
          >
            <CanvasViewContext.Provider value={view}>
              <ZoomBasis slideWidthEmu={slide.slideCx}>
                <TransformComponent
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%' }}
                >
                  <div
                    className={cn(
                      'grid size-full place-items-center [container-type:size]',
                      className,
                    )}
                  >
                    <div
                      ref={rememberHost}
                      style={{ width: `min(100cqw, 100cqh * ${slide.slideCx} / ${slide.slideCy})` }}
                      className="relative"
                    >
                      <div ref={rememberSlide} data-canvas-slide="" data-slide-id={slide.slideId}>
                        <SlideView
                          slide={slide}
                          profile={designSystem}
                          label={label}
                          resolveMedia={resolveMedia}
                          showOutside
                          className="bg-card text-foreground shadow-sm"
                        />
                      </div>
                      {/*
                       * Вуаль поля: приглушает всё, что вылезло за край, и рисует кромку слайда.
                       * Углы прямые, как у слайда в показе: кромка — ровно граница кадра.
                       */}
                      <div
                        aria-hidden
                        data-pasteboard-veil=""
                        className="pointer-events-none absolute inset-0 z-[1]"
                        style={{ boxShadow: PASTEBOARD_VEIL }}
                      />
                      {draft ? (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute z-[2] border border-[var(--canvas-selection)] bg-[var(--canvas-selection)]/10"
                          style={{
                            left: draft.x,
                            top: draft.y,
                            width: draft.width,
                            height: draft.height,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </TransformComponent>
                {/* Экранный слой: ручки, рамка выделения, подсветка и полоса свойств. */}
                <div ref={rememberOverlay} className="pointer-events-none absolute inset-0 z-20">
                  {overlay && area && slideRoot ? (
                    <SlideHandles
                      overlay={overlay}
                      area={area}
                      slideRoot={slideRoot}
                      slide={slide}
                      grid={aligned}
                      selectedIds={selectedIds}
                      editingId={editingId ?? editingTable?.elementId ?? null}
                      suspended={handTool || inserting || editingTable !== undefined}
                      onSelect={onSelect}
                      onCommit={onCommit}
                      onRotate={onRotate}
                      onGestureChange={setGesture}
                    />
                  ) : null}
                  {overlay && slideRoot ? (
                    <SelectionBar
                      overlay={overlay}
                      slideRoot={slideRoot}
                      slide={slide}
                      designSystem={designSystem}
                      selectedIds={selectedIds}
                      hidden={gesture || panning || handTool}
                      onRemove={onRemove}
                      onAlign={onAlign}
                      onFontSize={onFontSize}
                      onColor={onColor}
                    />
                  ) : null}
                </div>
                {slideRoot && editing?.kind === 'text' && session ? (
                  <TextEditor
                    slideRoot={slideRoot}
                    element={editing}
                    profile={designSystem}
                    slide={{ cx: slide.slideCx, cy: slide.slideCy }}
                    origin={
                      session.x === null || session.y === null
                        ? null
                        : { x: session.x, y: session.y }
                    }
                    finishRef={finishEditing}
                    onCommit={(paragraphs) => {
                      committedText.current = paragraphs;
                      onTextCommit(session.slideId, editing.elementId, paragraphs);
                    }}
                    onClose={() => {
                      // Пустой текст на слайде не остаётся: вставка и удаление схлопываются в
                      // журнале, и в истории от такой рамки нет и следа.
                      const text = committedText.current ?? editing.paragraphs;
                      committedText.current = null;
                      if (isBlank(text)) onRemoveElements([editing.elementId]);
                      // Как в Figma: после набора текст остаётся выделенным. Если выделение уже
                      // сменил клик по другому объекту, его не перебиваем.
                      else if (latest.current.selectedIds.length === 0) {
                        onSelect([editing.elementId]);
                      }
                      setSession(null);
                    }}
                  />
                ) : null}
                {slideRoot && editingTable?.kind === 'table' && tableSession ? (
                  <TableEditor
                    key={editingTable.elementId}
                    slideRoot={slideRoot}
                    element={editingTable}
                    profile={designSystem}
                    slide={{ cx: slide.slideCx, cy: slide.slideCy }}
                    focus={tableSession.focus}
                    finishRef={finishTable}
                    onCell={(cell, text) => onTableCell(editingTable.elementId, cell, text)}
                    onClose={() => setTableSession(null)}
                  />
                ) : null}
                {dropping ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-3 z-30 rounded-xl border-2 border-dashed border-[var(--canvas-selection)] bg-[var(--canvas-selection)]/5"
                  />
                ) : null}
                <FitSlide slideId={slide.slideId} />
                <ZoomHud onZoomToSelection={view.zoomToSelection} />
              </ZoomBasis>
            </CanvasViewContext.Provider>
          </TransformWrapper>
        </div>
      </ContextMenuTrigger>
      <CanvasMenuContent
        hasSelection={selectedIds.length > 0}
        canPaste={canPaste}
        hasLocked={hasLocked}
        onCommand={onCommand}
      />
    </ContextMenu>
  );
}
