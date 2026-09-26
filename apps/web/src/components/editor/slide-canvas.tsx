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
  DesignSystem,
  ImageCrop,
  Paragraph,
  SlideElement,
  SlideIr,
} from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';
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
import { SelectionBar, type SelectionBarActions } from '@/components/editor/selection-bar';
import { EDITOR_CHROME, isEditorChrome } from '@/components/editor/chrome-focus';
import {
  SlideHandles,
  type LineReshape,
  type SelectPick,
  type TurnedElement,
} from '@/components/editor/slide-handles';
import { TextEditor } from '@/components/editor/text-editor';
import { useEmptyTextPrompt } from '@/components/editor/empty-text';
import { typedText } from '@/components/editor/text-shortcuts';
import { ImageCropper } from '@/components/editor/image-cropper';
import { canHoldText, shapeAsText, shapeTextFrame } from '@/components/editor/shape-text';
import { TableEditor, type TableEntry } from '@/components/editor/table-editor';
import { TableHandles } from '@/components/editor/table-handles';
import { useTableClickEntry } from '@/components/editor/table-entry';
import type { TableOps } from '@/components/editor/use-table-ops';
import {
  arrowDirection,
  gridForSlide,
  nudgeBox,
  pixelBoxToEmu,
} from '@/components/editor/slide-geometry';
import { isTypingTarget } from '@/components/editor/slide-navigation';
import type { VariantId } from '@/components/editor/tool-rail';
import type { EditMode, ElementMove } from '@/components/editor/use-deck-history';
import { cn } from '@/lib/utils';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { CanvasMenuContent } from '@/components/editor/canvas-menu';
import type { CanvasCommand } from '@/components/editor/editor-keymap';
import { carriesFiles, imageFilesOf, pickImageFiles, registerImage } from '@/lib/image-files';

/** Здесь стрелки — свои клавиши виджета, а не сдвиг объекта. */
const ARROW_OWNERS =
  '[role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="slider"], [role="tablist"], [role="grid"], [role="toolbar"], [role="tree"], [role="dialog"]';
/** Отсюда протяжка вставки не начинается: это интерфейс поверх холста, а не поле. */
const INSERT_SKIPS = `[data-text-editor], [data-selection-bar], [data-text-format], [data-dock-obstacle], button, [role="menu"], ${EDITOR_CHROME}`;
/** Клик сюда не закрывает набор: это само поле, его полоса и кнопки поверх холста. */
const KEEPS_EDITING = `[data-text-editor], [data-text-format], [data-table-editor], button, [role="group"], ${EDITOR_CHROME}`;
/** Здесь буквы — клавиши виджета (поиск по пунктам, ячейки), а не начало набора в тексте. */
const TYPE_SKIPS =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="dialog"], [role="combobox"], [role="grid"], [data-table-editor]';
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
  /**
   * Закрыть открытый режим правки — набор, ячейки, кадрирование — с сохранением сделанного.
   * Нужен тем, кто уводит клавиатуру от холста: показ слайдов иначе делил бы стрелки и Esc с
   * кадрированием под собой.
   */
  finishModes(): void;
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
  tableOps,
  onRotate,
  onNudge,
  onDuplicate,
  onLineEnds,
  onRotateMany,
  controlRef,
  selectionActions,
  className,
  onPick,
  onEnterGroup,
  hoverUnit,
  highlightIds,
  canGroup,
  canUngroup,
  groupFrame,
  onShapeTextCommit,
  onCrop,
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
  /**
   * Закрытие набора: один `set-text`, не шаг на каждый символ. `box` — рамка, выросшая под
   * текст: её пишут той же записью журнала.
   */
  onTextCommit: (
    slideId: string,
    elementId: string,
    paragraphs: readonly Paragraph[],
    options?: { readonly box?: Box },
  ) => void;
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
  /** Правки таблицы: ячейки, строки и столбцы, размеры и вид. */
  tableOps: TableOps;
  /** Угол объекта после поворота ручкой. */
  onRotate: (elementId: string, rotation: number) => void;
  /** Сдвиг стрелкой: серия нажатий — один шаг отмены. Без него — как любой `onCommit`. */
  onNudge?: (moves: readonly ElementMove[]) => void;
  /** Alt+перетаскивание: копии со сдвигом в EMU, оригиналы на месте. */
  onDuplicate?: (elementIds: readonly string[], offset: { x: number; y: number }) => void;
  /** Конец линии перетащили: живой вид жеста, запись или отмена живого вида (`null`). */
  onLineEnds?: (elementId: string, line: LineReshape | null, mode: EditMode) => void;
  /** Поворот нескольких объектов вокруг общего центра: рамки и углы одной записью. */
  onRotateMany?: (turns: readonly TurnedElement[]) => void;
  /** Сюда холст кладёт то, что умеет по просьбе клавиатуры: см. `CanvasControl`. */
  controlRef?: { current: CanvasControl | null };
  /** Правки полосы свойств над выделением. */
  selectionActions: SelectionBarActions;
  className?: string;
  /**
   * Выбор щелчком, рамкой или правой кнопкой: редактор разворачивает объект в его группу.
   * Без него выбор идёт прямо в `onSelect`.
   */
  onPick?: (ids: readonly string[], pick?: SelectPick) => void;
  /** Двойной щелчок по объекту группы: `true` — редактор вошёл в группу, набор не нужен. */
  onEnterGroup?: (elementId: string) => boolean;
  /** Что выберет щелчок по объекту: его и подсвечивает наведение. */
  hoverUnit?: (elementId: string) => readonly string[];
  /** Подсветка объектов извне: строка панели слоёв под курсором. */
  highlightIds?: readonly string[];
  canGroup?: boolean;
  canUngroup?: boolean;
  /** Выделена одна группа: рамка вокруг неё, без рамок её объектов. */
  groupFrame?: boolean;
  /** Закрытие набора в фигуре: её абзацы одной записью журнала. */
  onShapeTextCommit?: (
    slideId: string,
    elementId: string,
    paragraphs: readonly Paragraph[],
  ) => void;
  /** Итог кадрирования картинки: доли срезанного и рамка кадра — одной записью журнала. */
  onCrop?: (elementId: string, crop: ImageCrop | null, box: Box) => void;
}) {
  const emptyText = useEmptyTextPrompt();
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
  // `typed` — символ, с которого начали печатать на выделенной рамке.
  const [session, setSession] = useState<{
    slideId: string;
    elementId: string;
    x: number | null;
    y: number | null;
    typed?: string;
  } | null>(null);
  const aligned = useMemo(
    () => gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy),
    [designSystem.grid, slide.slideCx, slide.slideCy],
  );
  const editing =
    session?.slideId === slide.slideId
      ? slide.elements.find(
          (item) =>
            item.elementId === session.elementId && (item.kind === 'text' || canHoldText(item)),
        )
      : undefined;
  const editingId = editing ? editing.elementId : null;
  // Кадрирование картинки: двойной клик или Enter. На это время выделение снято, ручки спрятаны.
  const [cropSession, setCropSession] = useState<{ slideId: string; elementId: string } | null>(
    null,
  );
  const cropping =
    cropSession?.slideId === slide.slideId
      ? slide.elements.find(
          (item) => item.elementId === cropSession.elementId && item.kind === 'image',
        )
      : undefined;
  const croppingUrl =
    cropping?.kind === 'image' ? (resolveMedia?.(cropping.mediaPart) ?? null) : null;
  const committedText = useRef<readonly Paragraph[] | null>(null);
  // Правка таблицы: второй щелчок, двойной щелчок или Enter. Таблица остаётся выделенной,
  // чтобы в панели были её ячейки, а ручки рамки на это время прячутся.
  const [tableSession, setTableSession] = useState<
    ({ slideId: string; elementId: string } & TableEntry) | null
  >(null);
  const finishTable = useRef<(() => void) | null>(null);
  const finishCrop = useRef<(() => void) | null>(null);
  const editingTable =
    tableSession?.slideId === slide.slideId
      ? slide.elements.find(
          (item) => item.elementId === tableSession.elementId && item.kind === 'table',
        )
      : undefined;

  // Клавиши и команды зума читают текущее, не пересоздавая слушателей на каждую правку.
  const latest = useRef({ slide, selectedIds, aligned, onCommit, onNudge });
  useEffect(() => {
    latest.current = { slide, selectedIds, aligned, onCommit, onNudge };
  });

  useEffect(() => {
    setSession(null);
    setTableSession(null);
    setCropSession(null);
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

  // Режим правки закрылся (набор, ячейки таблицы, кадрирование) — его поле ушло из DOM вместе с
  // фокусом, и клавиши достались бы `body`. Возвращаем их холсту: Esc, Delete и стрелки дальше
  // про выделенный объект. Если фокус уже ушёл в поле панели или в список, его не трогаем.
  const modeOpen = session !== null || tableSession !== null || cropSession !== null;
  const wasModeOpen = useRef(false);
  useEffect(() => {
    const closed = wasModeOpen.current && !modeOpen;
    wasModeOpen.current = modeOpen;
    if (!closed || !area) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) {
      area.focus({ preventScroll: true });
    }
  }, [area, modeOpen]);

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
      const { slide: current, selectedIds: ids, aligned: grid } = latest.current;
      const commit = latest.current.onNudge ?? latest.current.onCommit;
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
        const image = slide.elements.find((item) => item.elementId === picture.dataset.elementId);
        if (image?.kind !== 'image' || image.locked) return;
        // Как в Google Slides и Keynote: двойной клик — кадрирование. Пустой рамке кадрировать
        // нечего, ей сразу предлагается файл.
        if (resolveMedia?.(image.mediaPart)) {
          onSelect([]);
          setCropSession({ slideId: slide.slideId, elementId: image.elementId });
        } else void replaceImage(image.elementId);
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
          point: { x: event.clientX, y: event.clientY },
        });
        return;
      }
      // Текст в фигуре: тот же набор, что у текстового блока, внутри фигуры.
      const shape = target.closest('[data-kind="decor"]');
      if (shape instanceof HTMLElement && shape.dataset.elementId) {
        const element = slide.elements.find((item) => item.elementId === shape.dataset.elementId);
        if (canHoldText(element)) {
          event.preventDefault();
          onSelect([]);
          setSession({
            slideId: slide.slideId,
            elementId: element.elementId,
            x: event.clientX,
            y: event.clientY,
          });
          return;
        }
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
  }, [host, onSelect, replaceImage, resolveMedia, slide, tool]);

  // Как в Figma: двойной щелчок по группе сначала входит в неё, и только внутри — правит
  // объект. У выделенной группы сверху лежит область Moveable, поэтому объект под курсором
  // ищется по точке, а слушатель стоит на погружении: вход в группу — вместо набора, а не
  // вместе с ним.
  useEffect(() => {
    if (!area || !slideRoot || !onEnterGroup) return;
    const onDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || tool === 'hand' || isInsertTool(tool)) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('[data-text-editor]')) return;
      const onHandles = target.closest('.lct-moveable') !== null;
      if (!onHandles && !slideRoot.contains(target)) return;
      const member = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((node) => node.closest<HTMLElement>('[data-element-id]'))
        .find(
          (node): node is HTMLElement =>
            node !== null && slideRoot.contains(node) && node.dataset.locked !== 'true',
        );
      const id = member?.dataset.elementId;
      if ((id && onEnterGroup(id)) || onHandles) {
        // Двойной щелчок по рамке выделения — не щелчок по полю: слайд не вписывается заново.
        event.preventDefault();
        event.stopPropagation();
      }
    };
    area.addEventListener('dblclick', onDoubleClick, true);
    return () => area.removeEventListener('dblclick', onDoubleClick, true);
  }, [area, onEnterGroup, slideRoot, tool]);

  // Второй щелчок по выделенной таблице — каретка в ячейку под курсором.
  useTableClickEntry({
    host,
    slide,
    selectedIds,
    disabled: tool === 'hand' || inserting || tableSession !== null,
    onEnter: (elementId, focus, point) =>
      setTableSession({ slideId: slide.slideId, elementId, focus, point }),
  });
  // Границы колонок и строк тянутся у одной выделенной таблицы без поворота и в её правке.
  const selectedTable =
    selectedIds.length === 1
      ? slide.elements.find((item) => item.elementId === selectedIds[0])
      : undefined;
  const tableInFocus =
    editingTable?.kind === 'table'
      ? editingTable
      : selectedTable?.kind === 'table' && !selectedTable.locked && !inserting
        ? selectedTable
        : undefined;
  const resizableTable = (tableInFocus?.rotation ?? 0) === 0 ? tableInFocus : undefined;

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
        if (canHoldText(element)) {
          onSelect([]);
          setSession({ slideId: slide.slideId, elementId, x: null, y: null });
          return true;
        }
        if (element.kind === 'image' && resolveMedia?.(element.mediaPart)) {
          onSelect([]);
          setCropSession({ slideId: slide.slideId, elementId });
          return true;
        }
        if (element.kind === 'table') {
          onSelect([elementId]);
          setTableSession({
            slideId: slide.slideId,
            elementId,
            focus: { row: 0, column: 0 },
            selectAll: true,
          });
          return true;
        }
        return false;
      },
      focus: () => area?.focus({ preventScroll: true }),
      finishModes: () => {
        finishEditing.current?.();
        finishTable.current?.();
        finishCrop.current?.();
      },
    };
    controlRef.current = control;
    return () => {
      if (controlRef.current === control) controlRef.current = null;
    };
  }, [area, controlRef, onSelect, resolveMedia, slide]);

  // Печать на выделенном тексте открывает набор и дописывает символ (реестр: `type-to-edit`).
  // Фаза захвата: при выделенном тексте буквы инструментов рейки уступают набору.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const typed = typedText(event);
      if (!typed) return;
      const target = event.target;
      if (isTypingTarget(target)) return;
      if (target instanceof Element && target.closest(TYPE_SKIPS)) return;
      const { slide: current, selectedIds: ids } = latest.current;
      if (ids.length !== 1) return;
      const element = current.elements.find((item) => item.elementId === ids[0]);
      // Фигура, как в PowerPoint и Google Slides, тоже принимает напечатанное.
      const writable = element?.kind === 'text' ? !element.locked : canHoldText(element);
      if (!element || !writable) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect([]);
      setSession({
        slideId: current.slideId,
        elementId: element.elementId,
        x: null,
        y: null,
        typed,
      });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onSelect]);

  const selectUnderPointer = (event: ReactMouseEvent) => {
    const target = event.target;
    // В правке таблицы меню своё, у ячеек: выделение объекта оно не трогает.
    if (target instanceof Element && target.closest('[data-table-editor]')) return;
    // Рамка нескольких объектов или группы лежит поверх них: правый щелчок по ней — по
    // выделенному, меню открывается для него, а не снимает выделение.
    if (target instanceof Element && target.closest('.lct-moveable')) return;
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
    if (!selectedIds.includes(id)) (onPick ?? onSelect)([id]);
  };

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger
        asChild
        disabled={session !== null || tableSession !== null || cropping !== undefined || pan}
      >
        <div
          ref={rememberArea}
          // Фокус сюда ставят щелчок по холсту и переход между слайдами с клавиатуры; сам в
          // порядок Tab не входит.
          tabIndex={-1}
          data-canvas-area=""
          onContextMenu={selectUnderPointer}
          className={cn(
            'relative size-full overflow-hidden outline-none',
            // Жесты на холсте не выделяют текст страницы; поле набора и ячейки — выделяют.
            'select-none [&_[data-table-editor]]:select-text [&_[data-text-editor]]:select-text',
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
                          emptyText={emptyText}
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
                      suspended={
                        handTool ||
                        inserting ||
                        editingTable !== undefined ||
                        cropping !== undefined
                      }
                      onSelect={onPick ?? onSelect}
                      onCommit={onCommit}
                      onRotate={onRotate}
                      onDuplicate={onDuplicate}
                      onLineEnds={onLineEnds}
                      onRotateMany={onRotateMany}
                      onGestureChange={setGesture}
                      hoverUnit={hoverUnit}
                      highlightIds={highlightIds}
                      groupFrame={groupFrame}
                    />
                  ) : null}
                  {overlay && slideRoot ? (
                    <SelectionBar
                      overlay={overlay}
                      slideRoot={slideRoot}
                      slide={slide}
                      designSystem={designSystem}
                      selectedIds={selectedIds}
                      // Во время жеста, пана, набора в таблице и кадрирования полоса только
                      // мешала бы.
                      hidden={
                        gesture ||
                        panning ||
                        handTool ||
                        editingTable !== undefined ||
                        cropping !== undefined
                      }
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
                  {overlay && slideRoot && resizableTable && !gesture && !panning && !pan ? (
                    <TableHandles
                      overlay={overlay}
                      slideRoot={slideRoot}
                      slide={slide}
                      element={resizableTable}
                      editing={editingTable !== undefined}
                      ops={tableOps}
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
                    typed={session.typed ?? null}
                    finishRef={finishEditing}
                    onCommit={(paragraphs, box) => {
                      committedText.current = paragraphs;
                      onTextCommit(session.slideId, editing.elementId, paragraphs, { box });
                    }}
                    onClose={() => {
                      // Пустой текст на слайде не остаётся: вставка и удаление схлопываются в
                      // журнале, и в истории от такой рамки нет и следа. Рамка макета шаблона
                      // остаётся и пустой — с подсказкой, как плейсхолдер в PowerPoint.
                      const text = committedText.current ?? editing.paragraphs;
                      committedText.current = null;
                      if (isBlank(text) && editing.sourceShapeId === null) {
                        onRemoveElements([editing.elementId]);
                      }
                      // Как в Figma: после набора текст остаётся выделенным. Если выделение уже
                      // сменил клик по другому объекту, его не перебиваем.
                      else if (latest.current.selectedIds.length === 0) {
                        onSelect([editing.elementId]);
                      }
                      setSession(null);
                    }}
                  />
                ) : null}
                {slideRoot && editing?.kind === 'decor' && session ? (
                  <TextEditor
                    key={editing.elementId}
                    slideRoot={slideRoot}
                    element={shapeAsText(editing)}
                    shape={shapeTextFrame(
                      editing,
                      { cx: slide.slideCx, cy: slide.slideCy },
                      designSystem,
                    )}
                    profile={designSystem}
                    slide={{ cx: slide.slideCx, cy: slide.slideCy }}
                    origin={
                      session.x === null || session.y === null
                        ? null
                        : { x: session.x, y: session.y }
                    }
                    typed={session.typed ?? null}
                    finishRef={finishEditing}
                    onCommit={(paragraphs) =>
                      onShapeTextCommit?.(session.slideId, editing.elementId, paragraphs)
                    }
                    onClose={() => {
                      // Фигура остаётся и без текста; после набора она снова выделена.
                      if (latest.current.selectedIds.length === 0) onSelect([editing.elementId]);
                      setSession(null);
                    }}
                  />
                ) : null}
                {slideRoot && overlay && cropping?.kind === 'image' && croppingUrl ? (
                  <ImageCropper
                    key={cropping.elementId}
                    slideRoot={slideRoot}
                    overlay={overlay}
                    element={cropping}
                    size={{ cx: slide.slideCx, cy: slide.slideCy }}
                    url={croppingUrl}
                    finishRef={finishCrop}
                    onApply={(crop, box) => {
                      onCrop?.(cropping.elementId, crop, box);
                      setCropSession(null);
                      onSelect([cropping.elementId]);
                    }}
                    onCancel={() => {
                      setCropSession(null);
                      onSelect([cropping.elementId]);
                    }}
                    onReplace={() => {
                      setCropSession(null);
                      onSelect([cropping.elementId]);
                      void replaceImage(cropping.elementId);
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
                    entry={tableSession}
                    finishRef={finishTable}
                    ops={tableOps}
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
        canGroup={canGroup}
        canUngroup={canUngroup}
        onCommand={onCommand}
      />
    </ContextMenu>
  );
}
