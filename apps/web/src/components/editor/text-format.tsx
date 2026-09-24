'use client';

import { useEffect, useMemo, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { useEditorState, type EditorStateSnapshot } from '@tiptap/react';
import {
  autoUpdate,
  flip,
  hide,
  offset,
  shift,
  useFloating,
  type VirtualElement,
} from '@floating-ui/react-dom';
import type { DesignSystem } from '@lct/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BarSideContext, useRovingToolbar } from '@/components/editor/bar-controls';
import { TextBarControls, type TextBarActions } from '@/components/editor/bar-text-controls';
import { EDITOR_CHROME, keepFocusOnPress, stopCanvasMenu } from '@/components/editor/chrome-focus';
import {
  rangeMarks,
  setParagraphAlign,
  setRangeColor,
  setRangeFont,
  setRangeSize,
} from '@/components/editor/active-text-editor';
import { rangeLook, type TextElement } from '@/components/editor/inspector/text-model';
import {
  barBounds,
  formatBarAnchor,
  type RailSide,
  type ScreenRect,
} from '@/components/editor/text-format-anchor';
import {
  rangeFlagOn,
  sizeLadder,
  stepRangeSize,
  toggleRangeFlag,
  type InheritedText,
} from '@/components/editor/text-shortcuts';

/** Во время набора правки идут сразу в набор: живой вид и его конец не нужны. */
const NO_PREVIEW = () => undefined;

/** Зазор между полосой и тем, над чем она стоит, и отступ от краёв окна, px. */
const GAP = 8;
/** Высота полосы с зазором: столько места нужно над рамкой, чтобы встать над ней. */
const ROOM = 52;

function rectOf(rect: ScreenRect): DOMRect {
  return DOMRect.fromRect({
    x: rect.left,
    y: rect.top,
    width: Math.max(0, rect.right - rect.left),
    height: Math.max(0, rect.bottom - rect.top),
  });
}

const RAIL_SIDES: readonly RailSide[] = ['left', 'right', 'top', 'bottom'];

/** Где полосе можно стоять: видимая часть холста без рейки инструментов. */
function visibleBounds(dom: HTMLElement): ScreenRect | null {
  const area = dom.closest('[data-canvas-area]');
  if (!area) return null;
  const dock = dom.closest<HTMLElement>('[data-dock-side]');
  const rail = dock?.querySelector('[data-tool-rail]');
  const side = RAIL_SIDES.find((value) => value === dock?.dataset.dockSide);
  const rect = rail?.getBoundingClientRect();
  return barBounds(
    area.getBoundingClientRect(),
    rect && side && rect.width > 0 && rect.height > 0 ? { rect, side } : null,
  );
}

/** Та же область в виде, который понимают `flip` и `shift` Floating UI. */
function boundaryOf(editor: Editor) {
  const bounds = editor.isDestroyed ? null : visibleBounds(editor.view.dom);
  if (!bounds) return 'clippingAncestors' as const;
  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  };
}

/**
 * Якорь полосы на экране прямо сейчас. Читается на каждом кадре: холст двигают трансформом
 * (зум, пан), и событий прокрутки у этого нет.
 */
function anchorRect(editor: Editor): DOMRect {
  const dom = editor.view.dom;
  const frame = dom.getBoundingClientRect();
  try {
    const { from, to, empty } = editor.state.selection;
    const bounds = visibleBounds(dom);
    return rectOf(
      formatBarAnchor({
        frame,
        from: editor.view.coordsAtPos(from),
        to: editor.view.coordsAtPos(to, -1),
        empty,
        visibleTop: Math.max(0, bounds?.top ?? 0),
        room: ROOM,
      }),
    );
  } catch {
    // Поле закрывается: документ и вид уже разошлись. Держимся за рамку.
    return frame;
  }
}

/**
 * Полоса формата в открытом наборе — те же контролы, что у полосы над выделенным блоком, но
 * правят выделенные слова и абзацы под кареткой, как в Google Slides. Кнопки делают ровно то
 * же, что Ctrl+B/I/U и Ctrl+Shift+>/< в наборе. В журнал колоды всё уйдёт одним `set-text`,
 * когда набор закроется. Кнопки не забирают фокус у набора, а поля (кегль, HEX, поиск
 * шрифта) — забирают: набор это переживает, фокус там для него «свой».
 *
 * Полоса своя, на Floating UI, а не `BubbleMenu` Tiptap: тот в StrictMode терял свой узел и не
 * появлялся вовсе, а его корень не нёс `data-text-format`, и меню полосы закрывало набор. Стоит
 * над рамкой текста (см. `formatBarAnchor`) и идёт за ней при зуме и пане.
 */
export function TextFormatBar({
  editor,
  element,
  profile,
  inherited,
}: {
  editor: Editor;
  element: TextElement;
  profile: DesignSystem;
  /** Начертание роли: жирный заголовок нажат, пока его не сняли. */
  inherited: InheritedText;
}) {
  const t = useTranslations('formatBar');
  const roving = useRovingToolbar();
  // Только то, что рисует полоса: перерисовка — когда это меняется, а не на каждую
  // транзакцию. Флаги — с учётом роли, как у Ctrl+B/I/U.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }: EditorStateSnapshot<Editor>) => ({
      marks: rangeMarks(current),
      bold: rangeFlagOn(current, 'bold', inherited),
      italic: rangeFlagOn(current, 'italic', inherited),
      underline: rangeFlagOn(current, 'underline', inherited),
    }),
  });

  const reference = useMemo<VirtualElement>(
    () => ({
      getBoundingClientRect: () => anchorRect(editor),
      // Отсюда — предки с обрезкой: полоса прячется, когда текст ушёл за край холста.
      contextElement: editor.view.dom,
    }),
    [editor],
  );
  const { refs, floatingStyles, placement, isPositioned, middlewareData } = useFloating({
    strategy: 'fixed',
    placement: 'top',
    elements: { reference },
    middleware: [
      offset(GAP),
      // Над текстом, а без места сверху — под ним; вбок — не дальше видимого холста и рейки.
      flip(() => ({ padding: GAP, fallbackPlacements: ['bottom'], boundary: boundaryOf(editor) })),
      shift(() => ({ padding: GAP, boundary: boundaryOf(editor) })),
      hide(),
    ],
    whileElementsMounted: (anchor, floating, update) =>
      autoUpdate(anchor, floating, update, { animationFrame: true }),
  });
  const hidden = !isPositioned || middlewareData.hide?.referenceHidden === true;
  const setFloating = refs.setFloating;
  const setRoving = roving.ref;

  /*
   * Меню полосы, закрытое мышью, не возвращает фокус на свою кнопку (`useMenuFocus`), и он
   * падал бы в `body`: набор открыт, а печатать некуда. Фокус ушёл из меню или поповера полосы
   * в никуда — возвращаем его в текст, к той же каретке.
   */
  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target;
      if (event.relatedTarget !== null || !(target instanceof Element)) return;
      if (!target.closest(`[data-text-format], ${EDITOR_CHROME}`)) return;
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (!editor.isDestroyed) editor.commands.focus(null, { scrollIntoView: false });
      }, 0);
    };
    document.addEventListener('focusout', onFocusOut);
    return () => document.removeEventListener('focusout', onFocusOut);
  }, [editor]);

  /**
   * Escape на полосе — назад к тексту, как в Google Docs; стрелки ходят по кнопкам. Только на
   * самой полосе: меню и поповеры полей (они в портале) закрываются своим Escape. Подсказка
   * кнопки тоже закрывается по Escape, поэтому `defaultPrevented` здесь не помеха.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (event.key === 'Escape' && target instanceof Node && event.currentTarget.contains(target)) {
      if (target instanceof HTMLInputElement && target.getAttribute('aria-expanded') === 'true') {
        return;
      }
      event.preventDefault();
      editor.commands.focus(null, { scrollIntoView: false });
      return;
    }
    roving.onKeyDown(event);
  };

  const actions: TextBarActions = {
    look: {
      ...rangeLook(state.marks, element, profile),
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
    },
    live: false,
    setFont: (family) => setRangeFont(editor, family),
    setSize: (sizePt) => setRangeSize(editor, sizePt),
    stepSize: (step) => stepRangeSize(editor, inherited, sizeLadder(profile), step),
    toggleFlag: (flag) => toggleRangeFlag(editor, flag, inherited),
    setColor: (_color, hex) => setRangeColor(editor, hex),
    setAlign: (align) => setParagraphAlign(editor, align),
    onPreviewEnd: NO_PREVIEW,
  };

  return createPortal(
    <BarSideContext.Provider value={placement.startsWith('bottom') ? 'bottom' : 'top'}>
      <div
        ref={(node) => {
          setFloating(node);
          setRoving(node);
        }}
        data-text-format=""
        data-editor-chrome=""
        role="toolbar"
        aria-label={t('label')}
        aria-orientation="horizontal"
        onMouseDown={keepFocusOnPress}
        onContextMenu={stopCanvasMenu}
        onFocus={roving.onFocus}
        onKeyDown={onKeyDown}
        style={{ ...floatingStyles, visibility: hidden ? 'hidden' : 'visible' }}
        className="z-[4000] flex items-center gap-0.5 rounded-xl bg-card p-1 shadow-lg ring-1 shadow-black/25 ring-border select-none"
      >
        <TooltipProvider>
          <TextBarControls designSystem={profile} actions={actions} />
        </TooltipProvider>
      </div>
    </BarSideContext.Provider>,
    document.body,
  );
}
