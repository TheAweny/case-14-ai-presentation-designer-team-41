'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePanelRef } from 'react-resizable-panels';
import type { ColorValue, SlideElement } from '@lct/contracts';
import type {
  ArrangeTarget,
  DeckChangeKind,
  DeckSelection,
  ElementProps,
  TableCell,
} from '@lct/deck-ops';
import type { Deck } from '@/lib/deck-source';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/use-media-query';
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
import { InspectorToggle } from '@/components/editor/inspector/inspector-toggle';
import type { TableAction } from '@/components/editor/inspector/design-panel';
import type { ChartData } from '@/components/editor/inspector/chart-data';
import { editorCommand, type CanvasCommand } from '@/components/editor/editor-keymap';
import {
  ELEMENTS_MIME,
  paragraphsOf,
  parseElements,
  pasteOffset,
  plainTextOf,
  serializeElements,
} from '@/components/editor/element-clipboard';
import { createInsertedElements } from '@/components/editor/insert-element';
import { SlideCanvas } from '@/components/editor/slide-canvas';
import { blankSlideFrom } from '@/components/editor/slide-factory';
import { lockTemplateDecor } from '@/components/editor/template-lock';
import { useActiveTextEditor } from '@/components/editor/active-text-editor';
import { SlideList } from '@/components/editor/slide-list';
import {
  alignBoxes,
  gridForSlide,
  nudgeBox,
  type Alignment,
} from '@/components/editor/slide-geometry';
import { isTypingTarget, slideTitle } from '@/components/editor/slide-navigation';
import { ToolRailDock } from '@/components/editor/tool-rail-dock';
import type { VariantId } from '@/components/editor/tool-rail';
import {
  useDeckHistory,
  type EditMode,
  type ElementMove,
} from '@/components/editor/use-deck-history';
import { useSlideSelection } from '@/components/editor/use-slide-selection';
import { LocaleSwitcher } from '@/components/locale-switcher';

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
}: {
  deck: Deck;
  /** Адрес картинки по `mediaPart`. Нет адреса — на слайде рамка. */
  media?: Readonly<Record<string, string>>;
  /** Раскладка из cookie: сервер знает её заранее, поэтому колонки не прыгают. */
  layout?: EditorLayout;
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
  // Оформление шаблона заблокировано с самого начала: см. `lockTemplateDecor`.
  const startSlides = useMemo(() => lockTemplateDecor(deck.slides), [deck.slides]);
  const {
    slides,
    committedSlides,
    move,
    setText,
    remove,
    reorder,
    insert,
    setFontSize,
    setColor,
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
    removeSlide,
    setSlideBackground,
    setTableCell,
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
  } = useDeckHistory(startSlides);
  const history = useMemo(
    () => ({ undo: undoKind, redo: redoKind, onUndo: undo, onRedo: redo }),
    [undoKind, redoKind, undo, redo],
  );
  const { designSystem } = deck;
  const { index, select, selectById } = useSlideSelection(slides);
  const slide = slides[index];
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const activeText = useActiveTextEditor();
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

  const removeSelected = useCallback(() => {
    if (!slideId || selectedIds.length === 0) return;
    remove(slideId, selectedIds);
    setSelectedIds([]);
  }, [remove, selectedIds, slideId]);

  const alignSelected = useCallback(
    (alignment: Alignment) => {
      if (!slide) return;
      const items = slide.elements.filter((element) => selectedIds.includes(element.elementId));
      move(slide.slideId, alignBoxes(items, alignment));
    },
    [move, selectedIds, slide],
  );

  const setFontSizeOf = useCallback(
    (elementId: string, sizePt: number) => {
      if (!slideId) return;
      setFontSize(slideId, elementId, sizePt);
    },
    [setFontSize, slideId],
  );

  const setColorOf = useCallback(
    (elementId: string, color: ColorValue, hex: string) => {
      if (!slideId) return;
      setColor(slideId, elementId, color, hex);
    },
    [setColor, slideId],
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

  const setTableCellOf = useCallback(
    (elementId: string, cell: TableCell, text: string) => {
      if (slideId) setTableCell(slideId, elementId, cell, text);
    },
    [setTableCell, slideId],
  );

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
    (after: number) => {
      const base = slides[after];
      if (!base) return;
      insertSlide(after + 1, blankSlideFrom(base, crypto.randomUUID()));
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
  const removeSlideAt = useCallback(
    (at: number) => {
      const target = slides[at];
      if (target && slides.length > 1) removeSlide(target.slideId);
    },
    [removeSlide, slides],
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

  /** Одна точка входа для клавиатуры и контекстного меню холста. */
  const runCommand = useCallback(
    (command: CanvasCommand) => {
      if (command.kind === 'undo') return undo();
      if (command.kind === 'redo') return redo();
      if (!slide) return;
      const selected = slide.elements.filter((element) => selectedIds.includes(element.elementId));
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
      switch (command.kind) {
        case 'deselect':
          setSelectedIds([]);
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
          move(
            slide.slideId,
            selected.map((element) => ({
              elementId: element.elementId,
              box: nudgeBox(element.box, command.direction, grid, command.large),
            })),
          );
          return;
        }
      }
    },
    [
      arrange,
      designSystem.grid,
      duplicate,
      move,
      pasteElements,
      redo,
      rememberCopy,
      removeSelected,
      selectedIds,
      setProps,
      slide,
      undo,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || isTypingTarget(event.target)) return;
      const command = editorCommand(event);
      if (!command) return;
      const history = command.kind === 'undo' || command.kind === 'redo';
      const target = event.target;
      // В списке слайдов стрелки, удаление и выделение — его собственные клавиши.
      if (!history && target instanceof Element && target.closest('[role="listbox"]')) return;
      // Без выделения стрелки и Delete ничего не делают и не должны глушить браузер.
      if (!history && command.kind !== 'select-all' && selectedIds.length === 0) return;
      event.preventDefault();
      runCommand(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [runCommand, selectedIds.length]);

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
      const element: SlideElement = {
        ...box,
        box: {
          ...box.box,
          y: Math.round(box.box.y - (box.box.cy * (lines - 1)) / 2),
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

  return (
    <div className="h-dvh overflow-hidden bg-background">
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
          'h-full',
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
                designSystem={designSystem}
                labels={labels}
                current={index}
                resolveMedia={resolveMedia}
                onSelect={select}
                onReorder={reorder}
                onAdd={addSlide}
                onDuplicate={duplicateSlideAt}
                onRemove={removeSlideAt}
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

            <ResizablePanel id="canvas" minSize="40%" className="min-w-0">
              <ToolRailDock
                className="h-full min-w-0"
                railClassName="max-md:hidden"
                dock={initial.dock}
                onDockChange={(dock) => remember({ dock })}
                tool={tool}
                onToolChange={setTool}
                onAction={() => openInspector('assistant')}
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
                      onRemove={removeSelected}
                      onRemoveElements={(ids) => {
                        if (slideId) remove(slideId, ids);
                      }}
                      onAlign={alignSelected}
                      onInsert={(elements) => {
                        if (!slideId) return;
                        insert(slideId, elements);
                        // Как в Figma: объект вставлен — курсор снова выбирает.
                        setTool('select');
                      }}
                      onFontSize={setFontSizeOf}
                      onColor={setColorOf}
                      onReplaceImage={replaceImageOf}
                      onCommand={runCommand}
                      canPaste={canPaste}
                      hasLocked={slide.elements.some((element) => element.locked === true)}
                      onTableCell={setTableCellOf}
                      onRotate={(elementId, rotation) => setPropsOf([elementId], { rotation })}
                      className={CANVAS_PADDING}
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
              design={{
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
                onSlideBackground: setBackgroundOf,
                onTable: editTableOf,
                onChartData: setChartDataOf,
                onChartAxes: setChartAxesOf,
              }}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
