'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePanelRef } from 'react-resizable-panels';
import type { ColorValue, SlideElement, SlideIr } from '@lct/contracts';
import type { ArrangeTarget, DeckChangeKind, DeckSelection, ElementProps } from '@lct/deck-ops';
import {
  commitDuplicateSlides,
  commitGroup,
  commitMoveLayer,
  commitMoveSlides,
  commitRemoveSlides,
  commitImageCrop,
  commitShapeText,
  commitSlideNotes,
  commitUngroup,
} from '@lct/deck-ops';
import type { Deck, SlideLayout } from '@/lib/deck-source';
import { PRESENT_PARAM } from '@/lib/library-menu';
import { cn } from '@/lib/utils';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import { useMediaResolver } from '@/lib/media-registry';
import { imageFilesOf } from '@/lib/image-files';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ZoomBasis } from '@/components/editor/canvas-zoom';
import {
  EDITOR_LAYOUT_DEFAULT,
  INSPECTOR_WIDTH,
  SLIDES_WIDTH,
  writeEditorLayout,
  type EditorLayout,
} from '@/components/editor/editor-layout';
import { InspectorPanel, type InspectorTab } from '@/components/editor/inspector/inspector-panel';
import type { LayersPanelProps } from '@/components/editor/inspector/layers-panel';
import { InspectorToggle } from '@/components/editor/inspector/inspector-toggle';
import type { DesignPanelProps, TableAction } from '@/components/editor/inspector/design-panel';
import { useTableOps } from '@/components/editor/use-table-ops';
import { toggledFlag, wholeTable } from '@/components/editor/table-grid';
import type { ChartData } from '@/components/editor/inspector/chart-data';
import {
  editorCommand,
  type CanvasCommand,
  type EditorCommand,
} from '@/components/editor/editor-keymap';
import { ShortcutsDialog } from '@/components/editor/shortcuts-dialog';
import { SlideShow } from '@/components/editor/slide-show';
import { MobileBar } from '@/components/editor/mobile-bar';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { flagProps, sizeEntries } from '@/components/editor/text-shortcuts';
import {
  ELEMENTS_MIME,
  paragraphsOf,
  parseElements,
  pasteOffset,
  plainTextOf,
  serializeElements,
} from '@/components/editor/element-clipboard';
import { createInsertedElements } from '@/components/editor/insert-element';
import { SlideCanvas, type CanvasControl } from '@/components/editor/slide-canvas';
import type { LineReshape, TurnedElement } from '@/components/editor/slide-handles';
import { flipEntries } from '@/components/editor/inspector/selection-model';
import type { SelectionBarActions } from '@/components/editor/selection-bar';
import { layoutOf, slideFromLayout } from '@/components/editor/slide-factory';
import { lockTemplateDecor } from '@/components/editor/template-lock';
import { useActiveTextEditor } from '@/components/editor/active-text-editor';
import { SlideList } from '@/components/editor/slide-list';
import { gridForSlide, nudgeBox, type Alignment } from '@/components/editor/slide-geometry';
import { isTypingTarget, slideTitle, stepSlide } from '@/components/editor/slide-navigation';
import { FileBar } from '@/components/editor/file-bar';
import { ExportDialog, type ExportOptions } from '@/components/editor/export-dialog';
import { useDeckExport } from '@/components/editor/use-deck-export';
import { safeFileName, type DeckExporter, type ExportFormat } from '@/lib/deck-export';
import { createDemoExporter } from '@/mocks/demo-exporter';
import {
  alignUnits,
  canGroup,
  canUngroup,
  enterGroup,
  exitGroup,
  isWholeGroup,
  resolvePick,
  selectionScope,
  stepUnits,
  unitOf,
} from '@/components/editor/group-selection';
import { ToolRailDock } from '@/components/editor/tool-rail-dock';
import type { VariantId } from '@/components/editor/tool-rail';
import {
  useDeckHistory,
  type EditMode,
  type ElementMove,
} from '@/components/editor/use-deck-history';
import { useSlideSelection } from '@/components/editor/use-slide-selection';
import type { SelectPick } from '@/components/editor/slide-handles';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { SpeakerNotesPanel } from '@/components/editor/speaker-notes-panel';

/**
 * Ниже этой ширины правая панель сама уходит с глаз: иначе от слайда остаётся марка.
 * Та же граница стоит в классе `max-[1099px]:` ниже — решает её CSS, а не эффект,
 * чтобы на первом кадре панель не мелькала.
 */
const WIDE_SCREEN = '(min-width: 1100px)';

/**
 * Поля вокруг слайда. С той стороны, к которой прижата рейка, поле под неё; с остальных —
 * ровно столько, чтобы слайд не упирался в край, а в нижнем углу помещался масштаб.
 */
const CANVAS_PADDING = cn(
  'p-3 md:px-6 md:py-14',
  'md:group-data-[dock-side=left]/dock:pl-19',
  'md:group-data-[dock-side=right]/dock:pr-19',
  'md:group-data-[dock-side=top]/dock:pt-19',
  'md:group-data-[dock-side=bottom]/dock:pb-19',
);

/**
 * Состояние правой панели. `auto` — панель открыта, пока окно шире `WIDE_SCREEN`, и это
 * решает CSS. `open` и `closed` — человек уже сказал своё, и ширина окна тут не указ.
 */
type InspectorState = 'auto' | 'open' | 'closed';

/** Команды, которые работают и без выделения: история, слайды, шпаргалка. */
const WITHOUT_SELECTION: ReadonlySet<EditorCommand['kind']> = new Set<EditorCommand['kind']>([
  'undo',
  'redo',
  'select-all',
  'go-to-slide',
  'step-slide',
  'new-slide',
  'duplicate-slide',
  'shortcuts',
  'present',
]);

/** Команды колоды: работают и из списка слайдов, если список не забрал клавишу себе. */
const DECK_COMMANDS: ReadonlySet<EditorCommand['kind']> = new Set<EditorCommand['kind']>([
  'undo',
  'redo',
  'go-to-slide',
  'step-slide',
  'new-slide',
  'duplicate-slide',
  'shortcuts',
  'present',
]);

/** Переходы между слайдами: после них клавиатура у холста. */
const SLIDE_MOVES: ReadonlySet<EditorCommand['kind']> = new Set<EditorCommand['kind']>([
  'go-to-slide',
  'step-slide',
  'new-slide',
  'duplicate-slide',
]);

/** Здесь клавиши без модификатора (Enter, Tab, Home, End) не отбираем: у виджета они свои. */
const KEY_OWNERS =
  'button, a[href], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="tablist"], [role="toolbar"], [role="radiogroup"], [role="dialog"], [role="tree"]';

/** Фокус на холсте или нигде: Enter, Tab и Home/End здесь принадлежат редактору. */
function onCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  return target.closest('[data-canvas-area]') !== null && target.closest(KEY_OWNERS) === null;
}

/**
 * Enter, Tab, Home и End без модификаторов: у кнопок, меню и списков они свои, поэтому
 * редактор берёт их, только когда фокус на холсте. Delete и стрелки работают как раньше.
 */
function widgetKey(event: KeyboardEvent, command: EditorCommand): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return (
    command.kind === 'edit' || command.kind === 'select-step' || command.kind === 'go-to-slide'
  );
}

/** Правки, после которых редактор показывает их результат: новый объект или слайд. */
const FOLLOWS_SELECTION: ReadonlySet<DeckChangeKind> = new Set<DeckChangeKind>([
  'paste',
  'duplicate',
  'slide-insert',
  'slide-duplicate',
  'slide-remove',
]);

export function EditorShell({
  deck,
  media = {},
  layout: saved = EDITOR_LAYOUT_DEFAULT,
  presentOnOpen = false,
  onSlidesChange,
  saveStatus,
  exporter: givenExporter,
  assistant,
  openAssistant = false,
}: {
  deck: Deck;
  /** Адрес картинки по `mediaPart`. Нет адреса — на слайде рамка. */
  media?: Readonly<Record<string, string>>;
  /** Раскладка из cookie: сервер знает её заранее, поэтому колонки не прыгают. */
  layout?: EditorLayout;
  /** Сразу начать показ с первого слайда и убрать `?present=` из адреса. */
  presentOnOpen?: boolean;
  /** Записанные слайды после каждой правки (без живого вида жеста): для черновика колоды. */
  onSlidesChange?: (slides: readonly SlideIr[]) => void;
  /** Значок сохранения в подвале списка слайдов. */
  saveStatus?: ReactNode;
  /** Кто собирает файл. Пока API нет — демо: проходит те же этапы, но файла не создаёт. */
  exporter?: DeckExporter;
  /** Панель «Ассистент»: разговор с агентом о колоде. */
  assistant: ReactNode;
  /** Колоду открыл разговор с агентом — показать его сразу, в правой панели. */
  openAssistant?: boolean;
}) {
  const t = useTranslations('editor');
  const slidesPanelRef = usePanelRef();
  const inspectorPanelRef = usePanelRef();
  // Раскладка первого кадра. Дальше её ведут сами панели, а cookie только догоняет.
  const [initial] = useState(saved);
  const stored = useRef(saved);
  const [inspector, setInspector] = useState<InspectorState>('auto');
  const [tab, setTab] = useState<InspectorTab>('design');
  const wide = useMediaQuery(WIDE_SCREEN, true);
  const [tool, setTool] = useState<VariantId>('select');
  // Реестр знает адреса файлов, которые пользователь положил на слайд в этой вкладке.
  const resolveMedia = useMediaResolver(media);
  // Название живёт в редакторе, пока колоду некуда сохранить: API для этого ещё нет.
  const [title, setTitle] = useState(deck.title);
  const [exporter] = useState(() => givenExporter ?? createDemoExporter());
  const exportJob = useDeckExport(exporter);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pptx');
  // Оформление шаблона заблокировано с самого начала: см. `lockTemplateDecor`.
  const startSlides = useMemo(() => lockTemplateDecor(deck.slides), [deck.slides]);
  // Макеты — тоже оформление шаблона: слайд на макете начинается с заблокированной подложкой.
  const layouts = useMemo(
    () =>
      deck.layouts.map((layout) => ({
        ...layout,
        slide: lockTemplateDecor([layout.slide])[0] ?? layout.slide,
      })),
    [deck.layouts],
  );
  const {
    slides,
    committedSlides,
    move,
    nudge,
    reshape,
    setText,
    remove,
    insert,
    setProps,
    setPropsEach,
    endPreview,
    setFontSizes,
    setColorAll,
    arrange,
    replaceImage,
    duplicate,
    paste,
    lastChange,
    restored,
    insertSlide,
    duplicateSlide,
    setSlideBackground,
    insertTableRow,
    removeTableRow,
    insertTableColumn,
    removeTableColumn,
    setChartData,
    setChartAxes,
    undo,
    redo,
    undoKind,
    redoKind,
    run,
  } = useDeckHistory(startSlides);
  const history = useMemo(
    () => ({ undo: undoKind, redo: redoKind, onUndo: undo, onRedo: redo }),
    [undoKind, redoKind, undo, redo],
  );
  const { designSystem } = deck;
  // Черновик колоды хранит тот, кто открыл редактор: оболочка только сообщает правки.
  useEffect(() => {
    onSlidesChange?.(committedSlides);
  }, [committedSlides, onSlidesChange]);
  const { index, select, selectById } = useSlideSelection(slides);
  const slide = slides[index];
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const activeText = useActiveTextEditor();
  const canvasControl = useRef<CanvasControl | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Идёт показ слайдов: с какого слайда он начат. */
  const [show, setShow] = useState<{ start: number } | null>(null);
  // Узкий экран: рейки и правой панели нет, их заменяют нижняя панель и выезжающие свойства.
  const narrow = useMediaQuery(NARROW_SCREEN);
  const [sheetOpen, setSheetOpen] = useState(false);
  const slideId = slide?.slideId;
  // Выделение, которое надо поставить, когда откроется другой слайд: после отмены правки на
  // соседнем слайде редактор переходит туда и выделяет то, что было выделено.
  const pendingSelection = useRef<readonly string[] | null>(null);

  useEffect(() => {
    setSelectedIds(pendingSelection.current ?? []);
    pendingSelection.current = null;
  }, [slideId]);

  /** Открыть слайд и выделить на нём объекты — сразу или после перехода. */
  const reveal = useCallback(
    (target: DeckSelection) => {
      if (!target.slideId || target.slideId === slideId) {
        // Адрес мог указывать на слайд, которого после отмены уже нет: ставим его явно.
        if (target.slideId) selectById(target.slideId);
        setSelectedIds(target.elementIds);
        return;
      }
      pendingSelection.current = target.elementIds;
      selectById(target.slideId);
    },
    [selectById, slideId],
  );

  const remember = useCallback((patch: Partial<EditorLayout>) => {
    stored.current = { ...stored.current, ...patch };
    writeEditorLayout(stored.current);
  }, []);

  const openInspector = useCallback(
    (next?: InspectorTab) => {
      if (next) setTab(next);
      setInspector('open');
      const panel = inspectorPanelRef.current;
      if (panel?.isCollapsed()) panel.expand();
    },
    [inspectorPanelRef],
  );

  const closeInspector = useCallback(() => {
    setInspector('closed');
    inspectorPanelRef.current?.collapse();
  }, [inspectorPanelRef]);

  // Разговор, который собрал колоду, продолжается здесь же: панель открыта на «Ассистенте».
  // Через кадр: на узком окне панель спрятана, и развернуть её группа может, только когда
  // уже измерила себя после монтирования.
  useEffect(() => {
    if (!openAssistant) return;
    const frame = requestAnimationFrame(() => openInspector('assistant'));
    return () => cancelAnimationFrame(frame);
  }, [openAssistant, openInspector]);

  /**
   * Состояние панели — источник правды для её ширины. Тесное окно могло схлопнуть панель
   * само; когда место вернётся, панель вернётся вместе с ним.
   */
  useEffect(() => {
    const panel = inspectorPanelRef.current;
    if (!panel) return;
    if (inspector === 'closed') {
      if (!panel.isCollapsed()) panel.collapse();
    } else if (panel.isCollapsed()) {
      panel.expand();
    }
  });

  const commit = useCallback(
    (moves: readonly ElementMove[], mode?: EditMode) => {
      if (!slideId) return;
      move(slideId, moves, mode);
    },
    [move, slideId],
  );

  /** Стрелки: серия сдвигов подряд — один шаг отмены. */
  const nudgeOf = useCallback(
    (moves: readonly ElementMove[]) => {
      if (slideId) nudge(slideId, moves);
    },
    [nudge, slideId],
  );

  /** Alt+перетаскивание: копии там, куда дотащили, одной записью журнала. */
  const duplicateTo = useCallback(
    (elementIds: readonly string[], offset: { x: number; y: number }) => {
      if (slideId) duplicate(slideId, elementIds, offset);
    },
    [duplicate, slideId],
  );

  /** Конец линии: рамка и отражения вместе, живым видом на время жеста. */
  const reshapeLine = useCallback(
    (elementId: string, line: LineReshape | null, mode: EditMode) => {
      if (!slideId) return;
      if (!line) {
        endPreview();
        return;
      }
      const { box, ...props } = line;
      reshape(slideId, [{ elementId, box, props }], mode);
    },
    [endPreview, reshape, slideId],
  );

  /** Поворот выделения вокруг общего центра: рамки и углы одной записью журнала. */
  const rotateMany = useCallback(
    (turns: readonly TurnedElement[]) => {
      if (!slideId || turns.length === 0) return;
      reshape(
        slideId,
        turns.map(({ elementId, box, rotation }) => ({ elementId, box, props: { rotation } })),
      );
    },
    [reshape, slideId],
  );

  const removeSelected = useCallback(() => {
    if (!slideId || selectedIds.length === 0) return;
    remove(slideId, selectedIds);
    setSelectedIds([]);
  }, [remove, selectedIds, slideId]);

  // Группа выравнивается как один объект: её состав едет целиком.
  const alignSelected = useCallback(
    (alignment: Alignment) => {
      if (!slide) return;
      move(slide.slideId, alignUnits(slide.elements, selectedIds, alignment, slide));
    },
    [move, selectedIds, slide],
  );

  /*
   * Группы на холсте. Щелчок и рамка выбирают группу целиком, двойной щелчок входит в неё,
   * наведение подсвечивает то, что выберет щелчок. Уровень, на котором выбирают, следует из
   * самого выделения — см. `group-selection.ts`.
   */
  const pickOnCanvas = useCallback(
    (ids: readonly string[], pick?: SelectPick) => {
      if (!slide) return;
      setSelectedIds((previous) =>
        resolvePick(slide.elements, previous, ids, pick?.additive === true, pick?.deep === true),
      );
    },
    [slide],
  );
  const enterGroupAt = useCallback(
    (elementId: string) => {
      if (!slide) return false;
      const next = enterGroup(slide.elements, selectedIds, elementId);
      if (!next) return false;
      setSelectedIds(next);
      return true;
    },
    [selectedIds, slide],
  );
  const hoverUnit = useCallback(
    (elementId: string) =>
      slide
        ? unitOf(slide.elements, elementId, selectionScope(slide.elements, selectedIds))
        : [elementId],
    [selectedIds, slide],
  );
  const grouping = useMemo(
    () => ({
      canGroup: slide ? canGroup(slide.elements, selectedIds) : false,
      canUngroup: slide ? canUngroup(slide.elements, selectedIds) : false,
      wholeGroup: slide ? isWholeGroup(slide.elements, selectedIds) : false,
    }),
    [selectedIds, slide],
  );
  /** Строка панели слоёв под курсором: её объекты подсвечены на холсте. */
  const [layerHover, setLayerHover] = useState<readonly string[] | null>(null);
  useEffect(() => {
    setLayerHover(null);
  }, [slideId]);
  const moveLayer = useCallback(
    (layerId: string, overId: string) => {
      if (slideId) run([(current) => commitMoveLayer(current, { slideId, layerId, overId })]);
    },
    [run, slideId],
  );

  const setPropsOf = useCallback(
    (elementIds: readonly string[], props: ElementProps, mode?: EditMode) => {
      if (!slideId || elementIds.length === 0) return;
      setProps(slideId, elementIds, props, mode);
    },
    [setProps, slideId],
  );

  const setBackgroundOf = useCallback(
    (background: ColorValue | null, mode?: EditMode) => {
      if (slideId) setSlideBackground(slideId, background, mode);
    },
    [setSlideBackground, slideId],
  );

  // Таблицы: холст правит ячейки, границы и строки, панель — вид выделенных ячеек.
  const tableOps = useTableOps(run, endPreview, slideId);

  /** Строки и столбцы из панели: добавляются в конец, удаляются последние. */
  const editTableOf = useCallback(
    (elementId: string, action: TableAction) => {
      const table = slide?.elements.find((element) => element.elementId === elementId);
      if (!slideId || table?.kind !== 'table') return;
      if (action === 'add-row') insertTableRow(slideId, elementId, table.rows.length);
      if (action === 'remove-row') removeTableRow(slideId, elementId, table.rows.length - 1);
      if (action === 'add-column') insertTableColumn(slideId, elementId, table.headers.length);
      if (action === 'remove-column') {
        removeTableColumn(slideId, elementId, table.headers.length - 1);
      }
    },
    [insertTableColumn, insertTableRow, removeTableColumn, removeTableRow, slide, slideId],
  );

  const setChartDataOf = useCallback(
    (elementId: string, data: ChartData) => {
      if (slideId) setChartData(slideId, elementId, data.categories, data.series);
    },
    [setChartData, slideId],
  );
  const setChartAxesOf = useCallback(
    (elementId: string, titles: { xTitle?: string; yTitle?: string }) => {
      if (slideId) setChartAxes(slideId, elementId, titles);
    },
    [setChartAxes, slideId],
  );

  const replaceImageOf = useCallback(
    (elementId: string, mediaPart: string) => {
      if (!slideId) return;
      replaceImage(slideId, elementId, mediaPart);
    },
    [replaceImage, slideId],
  );

  const arrangeSelected = useCallback(
    (to: ArrangeTarget) => {
      if (!slideId || selectedIds.length === 0) return;
      arrange(slideId, selectedIds, to);
    },
    [arrange, selectedIds, slideId],
  );

  // Вставленное и продублированное выделяется сразу, новый слайд открывается, после удаления
  // открывается сосед. Отмена и повтор возвращают и слайд, и выделение. Только когда появилась
  // новая правка, а не при каждой смене слайда.
  useEffect(() => {
    if (!lastChange?.after) return;
    if (FOLLOWS_SELECTION.has(lastChange.kind)) reveal(lastChange.after);
  }, [lastChange]);
  useEffect(() => {
    if (restored) reveal(restored);
  }, [restored]);

  const addSlide = useCallback(
    (after: number, layout: SlideLayout | null) => {
      const base = slides[after];
      if (!base) return;
      insertSlide(after + 1, slideFromLayout(layout, base, crypto.randomUUID()));
    },
    [insertSlide, slides],
  );
  const duplicateSlideAt = useCallback(
    (at: number) => {
      const target = slides[at];
      if (target) duplicateSlide(target.slideId);
    },
    [duplicateSlide, slides],
  );

  // Несколько слайдов из списка: перенос, копии и удаление — одной записью журнала.
  const moveSlides = useCallback(
    (slideIds: readonly string[], at: number) => {
      run([(current) => commitMoveSlides(current, { slideIds, index: at })]);
    },
    [run],
  );
  const duplicateSlides = useCallback(
    (slideIds: readonly string[]) => {
      const copies = slideIds.map(() => crypto.randomUUID());
      run([(current) => commitDuplicateSlides(current, { slideIds, newSlideIds: copies })]);
      return copies;
    },
    [run],
  );
  const removeSlides = useCallback(
    (slideIds: readonly string[]) => {
      run([(current) => commitRemoveSlides(current, { slideIds })]);
    },
    [run],
  );

  /**
   * Скопированное в этой вкладке. Браузер может не донести свой тип данных до вставки, а меню
   * холста системный буфер прочитать не может, — тогда вставка берёт отсюда.
   */
  const copied = useRef<{ text: string; elements: readonly SlideElement[] } | null>(null);
  const [canPaste, setCanPaste] = useState(false);

  const rememberCopy = useCallback((elements: readonly SlideElement[]) => {
    const text = plainTextOf(elements);
    copied.current = { text, elements };
    setCanPaste(true);
    return text;
  }, []);

  const pasteElements = useCallback(
    (elements: readonly SlideElement[]) => {
      if (!slide) return;
      const grid = gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy);
      paste(slide.slideId, elements, pasteOffset(slide.elements, elements, grid.baseline * 4));
    },
    [designSystem.grid, paste, slide],
  );

  /**
   * Слайды с клавиатуры: Ctrl+1…9, PageUp/PageDown, Home/End, новый слайд и копия. Выделение
   * снимает сама смена слайда. `true` — команда была про слайды.
   */
  const runDeckCommand = useCallback(
    (command: CanvasCommand): boolean => {
      const count = slides.length;
      switch (command.kind) {
        case 'go-to-slide':
          select(command.index === 'last' ? count - 1 : Math.min(command.index, count - 1));
          return true;
        case 'step-slide':
          select(stepSlide(index, command.step, count));
          return true;
        case 'new-slide': {
          // Как в Google Slides: на макете открытого слайда.
          const opened = slides[index];
          addSlide(index, opened ? layoutOf(opened, layouts) : null);
          return true;
        }
        case 'duplicate-slide':
          duplicateSlideAt(index);
          return true;
        default:
          return false;
      }
    },
    [addSlide, duplicateSlideAt, index, layouts, select, slides],
  );

  /** Клавиши над выделенными объектами, которых нет в контекстном меню. */
  const runObjectCommand = useCallback(
    (command: CanvasCommand, selected: readonly SlideElement[]) => {
      if (!slide) return;
      const ids = selected.map((element) => element.elementId);
      const texts = selected.filter((element) => element.kind === 'text');
      const textIds = texts.map((element) => element.elementId);
      // Одна выделенная таблица: Ctrl+B/I/U и выравнивание — всем её ячейкам.
      const table = selected.length === 1 && selected[0]?.kind === 'table' ? selected[0] : null;
      switch (command.kind) {
        case 'edit':
          if (selected.length === 1 && selected[0]) {
            canvasControl.current?.startEditing(selected[0].elementId);
          }
          return;
        case 'lock': {
          // Повторное нажатие снимает блокировку. Заблокированный объект не выделяется и не
          // двигается, поэтому после блокировки выделение снимаем.
          const locked = selected.every((element) => element.locked === true);
          setProps(slide.slideId, ids, { locked: !locked });
          if (!locked) setSelectedIds([]);
          return;
        }
        case 'flip': {
          // Каждой фигуре — от её собственного отражения, одной записью журнала.
          const shapes = selected.filter((element) => element.kind === 'decor');
          if (shapes.length === 0) return;
          setPropsEach(
            slide.slideId,
            flipEntries(shapes, command.axis === 'horizontal' ? 'flipH' : 'flipV'),
          );
          return;
        }
        case 'text-flag':
          if (texts.length > 0) {
            setProps(slide.slideId, textIds, flagProps(texts, command.flag, designSystem));
          } else if (table) {
            const all = wholeTable(table);
            tableOps.style(table.elementId, all, {
              style: { [command.flag]: toggledFlag(table, all, command.flag) },
            });
          }
          return;
        case 'text-align':
          if (texts.length > 0) setProps(slide.slideId, textIds, { align: command.align });
          else if (table) {
            tableOps.style(table.elementId, wholeTable(table), { style: { align: command.align } });
          }
          return;
        case 'text-size':
          if (texts.length > 0) {
            setFontSizes(slide.slideId, sizeEntries(texts, designSystem, command.step));
          }
          return;
        default:
          return;
      }
    },
    [designSystem, setFontSizes, setProps, setPropsEach, slide, tableOps],
  );

  /**
   * Показ на весь экран. Выделение снимается: под показом холст продолжает слушать стрелки, и
   * выделенный объект не должен от них сдвинуться.
   */
  const startShow = useCallback((start: number) => {
    // Открытый набор, правка ячеек или кадрирование закрываются с сохранением: их клавиши
    // (стрелки, Enter, Esc) иначе перехватывали бы клавиши показа.
    canvasControl.current?.finishModes();
    setSelectedIds([]);
    setShow({ start });
  }, []);

  // Колоду открыли пунктом «Начать показ». Без жеста браузер не даст полный экран — показ
  // идёт поверх окна. Параметр убираем, чтобы обновление страницы не начинало показ снова.
  const presentedOnOpen = useRef(false);
  useEffect(() => {
    if (!presentOnOpen || presentedOnOpen.current) return;
    presentedOnOpen.current = true;
    startShow(0);
    const url = new URL(window.location.href);
    url.searchParams.delete(PRESENT_PARAM);
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [presentOnOpen, startShow]);

  /** Одна точка входа для клавиатуры и контекстного меню холста. */
  const runCommand = useCallback(
    (command: CanvasCommand) => {
      if (command.kind === 'undo') return undo();
      if (command.kind === 'present') {
        startShow(command.from === 'start' ? 0 : index);
        return;
      }
      if (command.kind === 'redo') return redo();
      if (command.kind === 'shortcuts') {
        setShortcutsOpen(true);
        return;
      }
      if (!slide) return;
      const selected = slide.elements.filter((element) => selectedIds.includes(element.elementId));
      if (runDeckCommand(command)) return;
      if (command.kind === 'select-step') {
        setSelectedIds(stepUnits(slide.elements, selectedIds, command.step));
        return;
      }
      if (command.kind === 'select-all') {
        setSelectedIds(
          slide.elements.filter((element) => !element.locked).map((element) => element.elementId),
        );
        return;
      }
      if (command.kind === 'paste') {
        if (copied.current) pasteElements(copied.current.elements);
        return;
      }
      if (command.kind === 'unlock-all') {
        const locked = slide.elements.filter((element) => element.locked).map((e) => e.elementId);
        if (locked.length === 0) return;
        setProps(slide.slideId, locked, { locked: false });
        setSelectedIds(locked);
        return;
      }
      if (selected.length === 0) return;
      const ids = selected.map((element) => element.elementId);
      switch (command.kind) {
        case 'deselect':
          // Внутри группы Esc поднимается на уровень вверх, как в Figma.
          setSelectedIds(exitGroup(slide.elements, selectedIds) ?? []);
          return;
        case 'group':
          run([(current) => commitGroup(current, { slideId: slide.slideId, elementIds: ids })]);
          return;
        case 'ungroup':
          run([(current) => commitUngroup(current, { slideId: slide.slideId, elementIds: ids })]);
          return;
        case 'remove':
          removeSelected();
          return;
        case 'duplicate':
          duplicate(slide.slideId, selectedIds);
          return;
        case 'arrange':
          arrange(slide.slideId, selectedIds, command.to);
          return;
        case 'copy':
        case 'cut': {
          // Из меню: системный буфер получает текст, объекты остаются в этой вкладке.
          const text = rememberCopy(selected);
          void navigator.clipboard?.writeText(text).catch(() => undefined);
          if (command.kind === 'cut') removeSelected();
          return;
        }
        case 'nudge': {
          const grid = gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy);
          nudge(
            slide.slideId,
            selected.map((element) => ({
              elementId: element.elementId,
              box: nudgeBox(element.box, command.direction, grid, command.large),
            })),
          );
          return;
        }
        default:
          runObjectCommand(command, selected);
      }
    },
    [
      arrange,
      designSystem.grid,
      duplicate,
      nudge,
      pasteElements,
      redo,
      rememberCopy,
      removeSelected,
      run,
      runDeckCommand,
      runObjectCommand,
      selectedIds,
      setProps,
      slide,
      undo,
      startShow,
      index,
    ],
  );

  // Формат из меню файла открывает выбор заново; кнопка «Экспорт» — то, что уже идёт или готово.
  const openExport = (format?: ExportFormat) => {
    if (format) {
      setExportFormat(format);
      if (exportJob.phase === 'done' || exportJob.phase === 'failed') exportJob.reset();
    }
    setExportOpen(true);
  };

  // В файл уходит записанная колода, а не живой вид жеста, который ещё не закончился.
  const startExport = (options: ExportOptions) => {
    const chosen =
      options.range === 'all'
        ? committedSlides
        : committedSlides.filter((item) => item.slideId === slideId);
    if (chosen.length === 0) return;
    setExportFormat(options.format);
    exportJob.start({
      deckId: deck.deckId,
      fileName: safeFileName(options.fileName, safeFileName(title, t('untitled'))),
      format: options.format,
      variant: deck.variant,
      slides: chosen,
      designSystem,
      audit: options.audit,
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      // В поле и в наборе текста клавиши — их; отсюда только шпаргалка. Ctrl+B и прочее
      // набор выполняет сам (см. `TextEditor`).
      const typing = isTypingTarget(event.target);
      const command = editorCommand(event, typing ? 'text' : 'canvas');
      if (!command) return;
      if (typing && command.kind !== 'shortcuts' && command.kind !== 'present') return;
      const target = event.target;
      // Открытое окно (та же шпаргалка) держит клавиатуру у себя.
      if (target instanceof Element && target.closest('[role="dialog"]')) return;
      const inList = target instanceof Element && target.closest('[role="listbox"]') !== null;
      // В списке слайдов стрелки, удаление и выделение — его собственные клавиши.
      if (inList && !DECK_COMMANDS.has(command.kind)) return;
      // В дереве слоёв стрелки ходят по строкам и сворачивают группы: объект от них не едет.
      // Delete там по-прежнему удаляет выбранное, как в Figma.
      const inTree = target instanceof Element && target.closest('[role="tree"]') !== null;
      if (inTree && command.kind === 'nudge') return;
      // Esc при инструменте вставки или руке — назад к выбору, как во всех редакторах (F-04);
      // выделение при этом остаётся.
      if (command.kind === 'deselect' && tool !== 'select' && onCanvas(target)) {
        event.preventDefault();
        setTool('select');
        return;
      }
      // Enter, Tab, Home, End — клавиши кнопок и меню, пока фокус на них. PageUp/PageDown
      // листают колоду отовсюду, кроме полей.
      if (widgetKey(event, command) && !onCanvas(target)) return;
      // Без выделения стрелки, Delete и Tab ничего не делают и не должны глушить браузер:
      // Tab без выделения уводит фокус как обычно, и с холста можно уйти с клавиатуры.
      if (!WITHOUT_SELECTION.has(command.kind) && selectedIds.length === 0) return;
      event.preventDefault();
      runCommand(command);
      // После перехода клавиатура у холста. Из списка фокус не уводим: там свой перебор
      // стрелками, и фокус идёт за открытым слайдом.
      if (SLIDE_MOVES.has(command.kind) && !inList) canvasControl.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runCommand, selectedIds.length, tool]);

  /**
   * Системный буфер обмена. Объекты кладутся своим типом данных и простым текстом рядом;
   * вставка берёт свои объекты, а чужой текст становится новым текстовым блоком. Картинки из
   * буфера вставляет холст.
   */
  useEffect(() => {
    const put = (event: ClipboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target) || !event.clipboardData) {
        return false;
      }
      const items = slide
        ? slide.elements.filter((element) => selectedIds.includes(element.elementId))
        : [];
      if (items.length === 0) return false;
      event.preventDefault();
      event.clipboardData.setData(ELEMENTS_MIME, serializeElements(items));
      event.clipboardData.setData('text/plain', rememberCopy(items));
      return true;
    };
    const onCopy = (event: ClipboardEvent) => {
      put(event);
    };
    const onCut = (event: ClipboardEvent) => {
      if (put(event)) removeSelected();
    };
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (event.defaultPrevented || isTypingTarget(event.target) || !data || !slide) return;
      if (imageFilesOf(data).length > 0) return;
      const text = data.getData('text/plain');
      // Браузер может не донести свой тип данных; тогда узнаём свою же копию по тексту.
      const elements =
        parseElements(data.getData(ELEMENTS_MIME)) ??
        (copied.current && copied.current.text === text ? copied.current.elements : null);
      if (elements) {
        event.preventDefault();
        pasteElements(elements);
        return;
      }
      if (text.trim() === '') return;
      event.preventDefault();
      const grid = gridForSlide(designSystem.grid, slide.slideCx, slide.slideCy);
      const paragraphs = paragraphsOf(text.trim());
      const center = {
        x: Math.round(slide.slideCx / 2),
        y: Math.round(slide.slideCy / 2),
        cx: 0,
        cy: 0,
      };
      const [box] = createInsertedElements('text', center, grid, { profile: designSystem });
      if (!box || box.kind !== 'text') return;
      const lines = paragraphs.length;
      // Вставленный текст — по центру слайда: инструмент ставит текст от точки клика, а у
      // вставки точки нет.
      const element: SlideElement = {
        ...box,
        box: {
          ...box.box,
          x: Math.round(center.x - box.box.cx / 2),
          y: Math.round(center.y - (box.box.cy * lines) / 2),
          cy: box.box.cy * lines,
        },
        paragraphs,
      };
      insert(slide.slideId, [element]);
      setSelectedIds([element.elementId]);
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [designSystem, insert, pasteElements, rememberCopy, removeSelected, selectedIds, slide]);

  /**
   * Правки полосы над выделением — те же пути записи, что у панели «Дизайн», и та же точка
   * входа для команд, что у клавиатуры и меню холста.
   */
  const selectionActions = useMemo<SelectionBarActions>(
    () => ({
      onCommit: commit,
      onAlign: alignSelected,
      onProps: setPropsOf,
      onPropsEach: (entries, mode) => {
        if (slideId) setPropsEach(slideId, entries, mode);
      },
      onPreviewEnd: endPreview,
      onFontSizes: (entries, mode) => {
        if (slideId) setFontSizes(slideId, entries, mode);
      },
      onColorAll: (ids, color, hex, mode) => {
        if (slideId) setColorAll(slideId, ids, color, hex, mode);
      },
      onReplaceImage: replaceImageOf,
      onStartCrop: (elementId) => canvasControl.current?.startEditing(elementId),
      onCommand: runCommand,
      onOpenInspector: () => openInspector('design'),
      canPaste,
    }),
    [
      alignSelected,
      canPaste,
      commit,
      endPreview,
      openInspector,
      replaceImageOf,
      runCommand,
      setColorAll,
      setFontSizes,
      setPropsEach,
      setPropsOf,
      slideId,
    ],
  );

  /** Подпись слайда для чтения с экрана: место в колоде и, если есть, заголовок. */
  const labels = useMemo(
    () =>
      slides.map((item, i) => {
        const values = { number: i + 1, total: slides.length };
        const title = slideTitle(item);
        return title === null
          ? t('slideLabel', values)
          : t('slideLabelTitled', { ...values, title });
      }),
    [slides, t],
  );

  /** Панель слоёв — там же, где «Дизайн»: справа и в нижней панели узкого экрана. */
  const layers: LayersPanelProps = {
    slide,
    selectedIds,
    onSelect: setSelectedIds,
    onHover: setLayerHover,
    onLock: (ids, locked) => setPropsOf(ids, { locked }),
    onMove: moveLayer,
  };

  /** Панель «Дизайн» — одна и та же справа и в нижней панели узкого экрана. */
  const design: DesignPanelProps = {
    // Панель считает значения без живого вида жеста: правка «каждому от своего»
    // идёт от записанного, а не от того, что сейчас показано.
    slide: committedSlides[index],
    designSystem,
    // Пока открыт набор, панель показывает редактируемый текст.
    selectedIds: activeText ? [activeText.elementId] : selectedIds,
    textEditor: activeText,
    onCommit: commit,
    onRemove: removeSelected,
    onAlign: alignSelected,
    onProps: setPropsOf,
    onPropsEach: (entries, mode) => {
      if (slideId) setPropsEach(slideId, entries, mode);
    },
    onPreviewEnd: endPreview,
    onFontSizes: (entries, mode) => {
      if (slideId) setFontSizes(slideId, entries, mode);
    },
    onColorAll: (ids, color, hex, mode) => {
      if (slideId) setColorAll(slideId, ids, color, hex, mode);
    },
    onArrange: arrangeSelected,
    onReplaceImage: replaceImageOf,
    onStartCrop: (elementId) => canvasControl.current?.startEditing(elementId),
    onResetCrop: (elementId) => {
      if (slideId) {
        run([(current) => commitImageCrop(current, { slideId, elementId, crop: null })]);
      }
    },
    onSlideBackground: setBackgroundOf,
    onTable: editTableOf,
    tableOps,
    onChartData: setChartDataOf,
    onChartAxes: setChartAxesOf,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ResizablePanelGroup
        id="editor"
        orientation="horizontal"
        data-inspector={inspector}
        onLayoutChanged={(_, meta) => {
          // Состояние панели меняет только человек. Схлопывание, которое библиотека сделала
          // сама, когда окну стало тесно, — это не решение «закрыть».
          if (!meta.isUserInteraction) return;
          const size = inspectorPanelRef.current?.getSize().inPixels ?? 0;
          if (size === 0) setInspector('closed');
          else {
            remember({ inspector: size });
            setInspector((current) => (current === 'closed' ? 'open' : current));
          }
        }}
        className={cn(
          'min-h-0 flex-1',
          // Узкое окно: панель свойств уходит целиком, вместе со своей ручкой. Решает CSS —
          // на первом кадре, ещё до гидратации, иначе панель успевала бы мелькнуть.
          'max-[1099px]:data-[inspector=auto]:[&>[data-inspector-part]]:hidden!',
        )}
      >
        <ResizablePanel id="workspace" minSize="45%" className="min-w-0">
          {/*
           * Слайды слева, холст в середине. На узком экране список уходит лентой вниз, и её
           * высоту задают сами миниатюры: колонки здесь превращаются в две строки.
           */}
          <ResizablePanelGroup
            id="workspace"
            orientation="horizontal"
            onLayoutChanged={(_, meta) => {
              if (!meta.isUserInteraction) return;
              const size = slidesPanelRef.current?.getSize().inPixels ?? 0;
              if (size > 0) remember({ slides: size });
            }}
            className={cn(
              'h-full',
              'max-md:flex-col-reverse!',
              'max-md:[&>[data-slides-panel]]:flex-none!',
            )}
          >
            <ResizablePanel
              id="slides"
              data-slides-panel=""
              panelRef={slidesPanelRef}
              defaultSize={initial.slides}
              minSize={SLIDES_WIDTH.min}
              maxSize={SLIDES_WIDTH.max}
              groupResizeBehavior="preserve-pixel-size"
              className="flex min-h-0 min-w-0 bg-sidebar max-md:touch-auto! md:flex-col"
            >
              <SlideList
                slides={slides}
                layouts={layouts}
                designSystem={designSystem}
                labels={labels}
                current={index}
                resolveMedia={resolveMedia}
                onSelect={select}
                onMove={moveSlides}
                onAdd={addSlide}
                onDuplicate={duplicateSlides}
                onRemove={removeSlides}
                className="min-h-0 min-w-0 flex-1"
              />
              {/*
               * Настройки приложения живут в подвале колонки, пока у редактора нет своего меню.
               * Там же счётчик: он про место в этом списке и не спорит с рейкой за края холста.
               */}
              <div
                className={cn(
                  'flex shrink-0 items-center justify-between gap-1 p-1.5',
                  'max-md:flex-col max-md:justify-center max-md:border-l md:border-t',
                  'border-border',
                )}
              >
                <LocaleSwitcher />
                {saveStatus}
                <p className="px-2 text-xs text-muted-foreground tabular-nums">
                  <span className="sr-only">
                    {t('slideLabel', { number: index + 1, total: slides.length })}
                  </span>
                  <span aria-hidden>
                    {t('counter', { number: index + 1, total: slides.length })}
                  </span>
                </p>
              </div>
            </ResizablePanel>

            <ResizableHandle aria-label={t('resizeSlides')} className="max-md:hidden" />

            <ResizablePanel id="canvas" minSize="40%" className="flex min-w-0 flex-col">
              <FileBar
                title={title}
                onRename={setTitle}
                onPresent={() => startShow(index)}
                onExport={openExport}
                exportPercent={
                  exportJob.phase === 'running' ? (exportJob.progress?.percent ?? 0) : null
                }
              />
              <ExportDialog
                open={exportOpen}
                onOpenChange={setExportOpen}
                job={exportJob}
                initialFormat={exportFormat}
                defaultFileName={safeFileName(title, t('untitled'))}
                slideCount={slides.length}
                currentIndex={index}
                variant={deck.variant}
                onStart={startExport}
              />
              <ToolRailDock
                className="min-h-0 min-w-0 flex-1"
                railClassName="max-md:hidden"
                dock={initial.dock}
                onDockChange={(dock) => remember({ dock })}
                tool={tool}
                onToolChange={setTool}
                onAction={(id) => {
                  if (id === 'shortcuts') setShortcutsOpen(true);
                  else if (id === 'present') startShow(index);
                  else openInspector('assistant');
                }}
                history={history}
              >
                {slide ? (
                  <ZoomBasis slideWidthEmu={slide.slideCx}>
                    <SlideCanvas
                      slide={slide}
                      designSystem={designSystem}
                      label={labels[index] ?? ''}
                      resolveMedia={resolveMedia}
                      selectedIds={selectedIds}
                      tool={tool}
                      onSelect={setSelectedIds}
                      onCommit={commit}
                      onTextCommit={setText}
                      onRemoveElements={(ids) => {
                        if (slideId) remove(slideId, ids);
                      }}
                      onInsert={(elements) => {
                        if (!slideId) return;
                        insert(slideId, elements);
                        // Как в Figma: объект вставлен — курсор снова выбирает.
                        setTool('select');
                      }}
                      onReplaceImage={replaceImageOf}
                      onCommand={runCommand}
                      canPaste={canPaste}
                      hasLocked={slide.elements.some((element) => element.locked === true)}
                      tableOps={tableOps}
                      onRotate={(elementId, rotation) => setPropsOf([elementId], { rotation })}
                      onNudge={nudgeOf}
                      onDuplicate={duplicateTo}
                      onLineEnds={reshapeLine}
                      onRotateMany={rotateMany}
                      controlRef={canvasControl}
                      selectionActions={selectionActions}
                      className={CANVAS_PADDING}
                      onPick={pickOnCanvas}
                      onEnterGroup={enterGroupAt}
                      hoverUnit={hoverUnit}
                      highlightIds={layerHover ?? undefined}
                      canGroup={grouping.canGroup}
                      canUngroup={grouping.canUngroup}
                      groupFrame={grouping.wholeGroup}
                      onShapeTextCommit={(target, elementId, paragraphs) =>
                        run([
                          (current) =>
                            commitShapeText(current, { slideId: target, elementId, paragraphs }),
                        ])
                      }
                      onCrop={(elementId, crop, box) => {
                        if (slideId) {
                          run([
                            (current) =>
                              commitImageCrop(current, { slideId, elementId, crop, box }),
                          ]);
                        }
                      }}
                    />
                  </ZoomBasis>
                ) : null}
                {inspector === 'open' ? null : (
                  <InspectorToggle
                    onOpen={openInspector}
                    // В `auto` кнопка нужна только там, где панель сама ушла: между узким
                    // экраном (там панели нет вовсе) и порогом, с которого она открыта.
                    className={cn(
                      'hidden',
                      inspector === 'closed' ? 'md:block' : 'md:max-[1099px]:block',
                    )}
                  />
                )}
              </ToolRailDock>
              {slide ? (
                <SpeakerNotesPanel
                  className="max-md:hidden"
                  slideId={slide.slideId}
                  notes={slide.notes}
                  onCommit={(target, notes) =>
                    run([(current) => commitSlideNotes(current, { slideId: target, notes })])
                  }
                />
              ) : null}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          data-inspector-part=""
          aria-label={t('resizeInspector')}
          // Схлопнутую панель ручка не тянет: её возвращает кнопка на холсте.
          disabled={inspector === 'closed' || (inspector === 'auto' && !wide)}
          className={cn(inspector === 'closed' && 'hidden')}
        />

        <ResizablePanel
          id="inspector"
          data-inspector-part=""
          panelRef={inspectorPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={initial.inspector}
          minSize={INSPECTOR_WIDTH.min}
          maxSize={INSPECTOR_WIDTH.max}
          groupResizeBehavior="preserve-pixel-size"
          className="min-w-0"
        >
          {inspector === 'closed' ? null : (
            <InspectorPanel
              tab={tab}
              onTabChange={setTab}
              onCollapse={closeInspector}
              design={design}
              layers={layers}
              assistant={assistant}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      <MobileBar
        className="md:hidden"
        history={history}
        tool={tool}
        onToolChange={setTool}
        onPresent={() => startShow(index)}
        onProperties={() => setSheetOpen(true)}
      />
      <Sheet open={sheetOpen && narrow} onOpenChange={setSheetOpen}>
        <SheetContent className="h-[min(60dvh,36rem)]">
          <SheetTitle className="sr-only">{t('inspector')}</SheetTitle>
          <SheetDescription className="sr-only">{labels[index] ?? ''}</SheetDescription>
          <div className="min-h-0 flex-1">
            <InspectorPanel
              tab={tab}
              onTabChange={setTab}
              onCollapse={() => setSheetOpen(false)}
              design={design}
              layers={layers}
              assistant={assistant}
            />
          </div>
        </SheetContent>
      </Sheet>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {show ? (
        <SlideShow
          slides={slides}
          designSystem={designSystem}
          labels={labels}
          start={show.start}
          resolveMedia={resolveMedia}
          onExit={(at) => {
            setShow(null);
            select(at);
            canvasControl.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
