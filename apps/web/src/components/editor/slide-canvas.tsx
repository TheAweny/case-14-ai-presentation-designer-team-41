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
import type { Box, DesignSystem, Paragraph, SlideElement, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
import type { TableCell } from '@lct/deck-ops';
import { FitSlide, ZoomBasis, ZoomHud } from '@/components/editor/canvas-zoom';
import { zoomScaleFor } from '@/components/editor/zoom-input';
import {
  CanvasViewContext,
  clampCanvasScale,
  clampPosition,
  KEY_ZOOM_FACTOR,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  transformToFit,
  wheelZoomFactor,
  type CanvasView,
} from '@/components/editor/canvas-viewport';
import {
  createImageElement,
  createInsertedElements,
  isInsertTool,
  type InsertTool,
} from '@/components/editor/insert-element';
import { SelectionBar, type SelectionBarActions } from '@/components/editor/selection-bar';
import { EDITOR_CHROME, isEditorChrome } from '@/components/editor/chrome-focus';
import { SlideHandles } from '@/components/editor/slide-handles';
import { TextEditor } from '@/components/editor/text-editor';
import { TableEditor, type GridCell } from '@/components/editor/table-editor';
import {
  arrowDirection,
  gridForSlide,
  nudgeBox,
  pixelBoxToEmu,
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
  '[role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="slider"], [role="tablist"], [role="toolbar"]';
/** Клик сюда не закрывает набор: это само поле, его полоса и кнопки поверх холста. */
const KEEPS_EDITING = `[data-text-editor], [data-text-format], [data-table-editor], button, [role="group"], ${EDITOR_CHROME}`;

function isFormField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea, select') !== null;
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
  onRemoveElements,
  onInsert,
  onReplaceImage,
  onCommand,
  canPaste,
  hasLocked,
  onTableCell,
  onRotate,
  selectionActions,
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
  /** Удалить эти объекты, выделены они или нет: пустой текст после набора. */
  onRemoveElements: (elementIds: readonly string[]) => void;
  /** Новый объект. В журнал он попадает целиком, одним шагом. */
  onInsert: (elements: readonly SlideElement[]) => void;
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
  /** Правки полосы свойств над выделением. */
  selectionActions: SelectionBarActions;
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
  const [spacePan, setSpacePan] = useState(false);
  const [fitWidth, setFitWidth] = useState(0);
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const pan = tool === 'hand' || spacePan;
  const inserting = isInsertTool(tool);
  const [session, setSession] = useState<{
    slideId: string;
    elementId: string;
    x: number;
    y: number;
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
      const target = event.target;
      if (target instanceof Element && target.closest(KEEPS_EDITING)) return;
      finishEditing.current?.();
      finishTable.current?.();
    };
    area.addEventListener('pointerdown', onDown, true);
    return () => area.removeEventListener('pointerdown', onDown, true);
  }, [area, session, tableSession]);

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
      const fx = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const fy = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
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
      if (point) void api()?.zoomToPoint(clampCanvasScale(scale), point.x, point.y, 0);
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
        void controls.setTransform(
          clampPosition(next.positionX, box.width, next.scale),
          clampPosition(next.positionY, box.height, next.scale),
          next.scale,
          0,
        );
      },
    };
  }, [actualScale, slideRoot]);

  // Пробел временно включает руку, как у инструментов выбора. В поле ввода и на кнопках он
  // остаётся прежним: пробел в списке слайдов поднимает миниатюру для перестановки.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (isTypingTarget(event.target)) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('button, a, [role="listbox"], [role="toolbar"], [role="menu"]')
      ) {
        return;
      }
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

  // Клавиши зума: Ctrl/Cmd+= и − по шагу, Ctrl/Cmd+0 — 100 %, Shift+1 — вписать,
  // Shift+2 — к выделению. Ctrl-зум работает и во время набора: браузерный зум страницы тут лишний.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      if (event.metaKey || event.ctrlKey) {
        if (isFormField(event.target)) return;
        if (event.code === 'Equal' || event.code === 'NumpadAdd') view.zoomBy(KEY_ZOOM_FACTOR);
        else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
          view.zoomBy(1 / KEY_ZOOM_FACTOR);
        } else if (event.code === 'Digit0' || event.code === 'Numpad0') view.zoomToActual();
        else return;
        event.preventDefault();
        return;
      }
      if (!event.shiftKey || isTypingTarget(event.target)) return;
      if (event.code === 'Digit1') view.zoomToFit();
      else if (event.code === 'Digit2') view.zoomToSelection();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view]);

  // Ctrl/Cmd+колесо и щипок тачпада — плавный зум к курсору. Без модификатора колесо и два
  // пальца двигают увеличенный лист: это делает сама библиотека (trackPadPanning).
  useEffect(() => {
    if (!area) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const controls = transformRef.current;
      if (!controls) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = controls.instance.state.scale;
      const next = clampCanvasScale(scale * wheelZoomFactor(event.deltaY, event.deltaMode));
      if (next !== scale) void controls.zoomToPoint(next, event.clientX, event.clientY, 0);
    };
    area.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => area.removeEventListener('wheel', onWheel, { capture: true });
  }, [area]);

  useEffect(() => {
    if (!host || pan || !isInsertTool(tool)) return;
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
      if (!(target instanceof Element) || !host.contains(target)) return;
      if (
        target.closest(
          `[data-text-editor], [data-selection-bar], [data-text-format], ${EDITOR_CHROME}`,
        )
      ) {
        return;
      }
      event.preventDefault();
      pointer = event.pointerId;
      host.setPointerCapture(pointer);
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
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
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
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', finish);
    host.addEventListener('pointercancel', cancel);
    return () => {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', finish);
      host.removeEventListener('pointercancel', cancel);
    };
  }, [aligned, designSystem, host, insertImages, onInsert, onSelect, pan, slide, tool]);

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

  const selectUnderPointer = (event: ReactMouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !slideRoot?.contains(target)) {
      if (isEditorChrome(target)) return;
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
          onContextMenu={selectUnderPointer}
          className={cn('relative size-full overflow-hidden [container-type:size]', className)}
        >
          {/*
           * Лист уже вписан в область контейнером размеров. Библиотека масштабирует этот вписанный
           * лист: единица — это «вписать». Ctrl+колесо и щипок увеличивают к курсору, колесо и два
           * пальца двигают увеличенный лист, рука и пробел тащат его.
           */}
          <TransformWrapper
            ref={transformRef}
            minScale={MIN_CANVAS_SCALE}
            maxScale={MAX_CANVAS_SCALE}
            centerOnInit
            centerZoomedOut
            limitToBounds
            disablePadding
            doubleClick={{ disabled: true }}
            keyboard={{ disabled: true }}
            autoAlignment={{ disabled: true }}
            velocityAnimation={{ disabled: true }}
            zoomAnimation={{ disabled: true }}
            wheel={{ disabled: true }}
            trackPadPanning={{ disabled: false, velocityDisabled: true }}
            panning={{ disabled: !pan, allowLeftClickPan: true, velocityDisabled: true }}
          >
            <CanvasViewContext.Provider value={view}>
              <ZoomBasis slideWidthEmu={slide.slideCx}>
                <TransformComponent
                  wrapperClass={pan ? 'cursor-grab active:cursor-grabbing' : ''}
                  wrapperStyle={{ width: '100%', height: '100%' }}
                  contentStyle={{ width: '100%', height: '100%' }}
                >
                  <div className="grid size-full place-items-center">
                    <div
                      ref={rememberHost}
                      style={{ width: `min(100cqw, 100cqh * ${slide.slideCx} / ${slide.slideCy})` }}
                      className={cn('relative', inserting && 'cursor-crosshair touch-none')}
                    >
                      <div ref={rememberSlide} data-canvas-slide="" data-slide-id={slide.slideId}>
                        <SlideView
                          slide={slide}
                          profile={designSystem}
                          label={label}
                          resolveMedia={resolveMedia}
                          className="rounded-xl bg-card text-foreground shadow-sm ring-1 ring-border"
                        />
                      </div>
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
                      suspended={pan || inserting || editingTable !== undefined}
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
                      // Во время жеста и набора в таблице полоса только мешала бы.
                      hidden={gesture || pan || editingTable !== undefined}
                      actions={selectionActions}
                      onEditTable={(elementId) =>
                        setTableSession({
                          slideId: slide.slideId,
                          elementId,
                          focus: { row: 0, column: 0 },
                        })
                      }
                    />
                  ) : null}
                </div>
                {slideRoot && editing?.kind === 'text' && session ? (
                  <TextEditor
                    slideRoot={slideRoot}
                    element={editing}
                    profile={designSystem}
                    slide={{ cx: slide.slideCx, cy: slide.slideCy }}
                    origin={{ x: session.x, y: session.y }}
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
