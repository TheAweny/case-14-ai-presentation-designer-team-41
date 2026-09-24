'use client';

import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { useEditorState, type EditorStateSnapshot } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { DesignSystem } from '@lct/contracts';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/components/editor/bar-controls';
import { TextBarControls, type TextBarActions } from '@/components/editor/bar-text-controls';
import { keepFocusOnPress, stopCanvasMenu } from '@/components/editor/chrome-focus';
import {
  rangeMarks,
  setParagraphAlign,
  setRangeColor,
  setRangeFont,
  setRangeSize,
} from '@/components/editor/active-text-editor';
import { rangeLook, type TextElement } from '@/components/editor/inspector/text-model';
import {
  rangeFlagOn,
  sizeLadder,
  stepRangeSize,
  toggleRangeFlag,
  type InheritedText,
} from '@/components/editor/text-shortcuts';

/*
 * BubbleMenu пересылает плагину свои опции транзакцией всякий раз, когда меняется ссылка на
 * `shouldShow`, `appendTo` или `options`. Инлайн-значения менялись бы на каждом рендере, а
 * рендер шёл от транзакции, — отсюда бесконечный цикл. Поэтому все три живут в модуле.
 */
const ALWAYS_SHOW = () => true;
const APPEND_TO_BODY = () => document.body;
const MENU_OPTIONS = { placement: 'top', offset: 8 } as const;

/** Во время набора правки идут сразу в набор: живой вид и его конец не нужны. */
const NO_PREVIEW = () => undefined;

/**
 * Полоса формата в открытом наборе — те же контролы, что у полосы над выделенным блоком, но
 * правят выделенные слова и абзацы под кареткой, как в Google Slides. Кнопки делают ровно то
 * же, что Ctrl+B/I/U и Ctrl+Shift+>/< в наборе. В журнал колоды всё уйдёт одним `set-text`,
 * когда набор закроется. Кнопки не забирают фокус у набора, а поля (кегль, HEX, поиск
 * шрифта) — забирают: набор это переживает, фокус там для него «свой».
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

  return (
    <BubbleMenu
      ref={roving.ref}
      editor={editor}
      shouldShow={ALWAYS_SHOW}
      appendTo={APPEND_TO_BODY}
      options={MENU_OPTIONS}
      data-text-format=""
      data-editor-chrome=""
      role="toolbar"
      aria-label={t('label')}
      onMouseDown={keepFocusOnPress}
      onContextMenu={stopCanvasMenu}
      onFocus={roving.onFocus}
      onKeyDown={roving.onKeyDown}
      className="z-[4000] flex items-center gap-0.5 rounded-xl bg-card p-1 shadow-lg ring-1 shadow-black/25 ring-border"
    >
      <TooltipProvider>
        <TextBarControls designSystem={profile} actions={actions} />
      </TooltipProvider>
    </BubbleMenu>
  );
}
