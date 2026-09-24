'use client';

import { useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import type { ParagraphAlign } from '@lct/contracts';

/**
 * Открытый на холсте редактор текста. Панель «Дизайн» правит через него выделенный фрагмент,
 * как Figma во время набора: кнопки меняют слова под кареткой, а в журнал колоды всё уходит
 * одним `set-text`, когда набор закрывается.
 */
export interface ActiveTextEditor {
  readonly editor: Editor;
  readonly elementId: string;
}

let active: ActiveTextEditor | null = null;
const listeners = new Set<() => void>();

export function setActiveTextEditor(next: ActiveTextEditor | null): void {
  if (active?.editor === next?.editor && active?.elementId === next?.elementId) return;
  active = next;
  for (const listener of listeners) listener();
}

/** Снять регистрацию, только если открыт всё ещё этот редактор. */
export function clearActiveTextEditor(editor: Editor): void {
  if (active?.editor === editor) setActiveTextEditor(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveTextEditor(): ActiveTextEditor | null {
  return useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );
}

/**
 * Куда может уйти фокус, не закрывая набор: полоса форматирования, текстовая секция панели и
 * их выпадающие меню. Всё остальное — конец набора.
 */
export const KEEPS_TEXT_FOCUS = '[data-text-format], [data-text-panel], [role="menu"]';

const ON = 'true';
const OFF = 'false';

/**
 * Жирный или курсив на выделении — явно, включая «выключено»: у заголовка жирность от роли,
 * и одно снятие метки её не отменило бы.
 */
export function setRunFlag(editor: Editor, flag: 'bold' | 'italic' | 'underline', on: boolean) {
  const chain = editor.chain().focus();
  if (flag === 'underline') {
    chain.setMark('textStyle', { underlineMode: on ? ON : OFF }).run();
    return;
  }
  const mode = flag === 'bold' ? 'boldMode' : 'italicMode';
  if (on)
    chain
      .setMark(flag)
      .setMark('textStyle', { [mode]: ON })
      .run();
  else
    chain
      .unsetMark(flag)
      .setMark('textStyle', { [mode]: OFF })
      .run();
}

/** Выравнивание абзацев, которых касается выделение. */
export function setParagraphAlign(editor: Editor, align: ParagraphAlign) {
  editor.chain().focus().updateAttributes('paragraph', { align }).run();
}

export function setRangeSize(editor: Editor, sizePt: number) {
  editor.chain().focus().setFontSize(String(sizePt)).run();
}

export function setRangeColor(editor: Editor, hex: string) {
  editor.chain().focus().setColor(`#${hex}`).run();
}

/** Что сейчас под кареткой или на выделении: сырые атрибуты, наследование считает панель. */
export interface RangeMarks {
  readonly bold: boolean;
  readonly boldMode: string | null;
  readonly italic: boolean;
  readonly italicMode: string | null;
  readonly underlineMode: string | null;
  readonly sizePt: number | null;
  readonly color: string | null;
  readonly align: ParagraphAlign | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

export function rangeMarks(editor: Editor): RangeMarks {
  const style = editor.getAttributes('textStyle');
  const paragraph = editor.getAttributes('paragraph');
  const size = Number(style.fontSize);
  const align = text(paragraph.align);
  return {
    bold: editor.isActive('bold'),
    boldMode: text(style.boldMode),
    italic: editor.isActive('italic'),
    italicMode: text(style.italicMode),
    underlineMode: text(style.underlineMode),
    sizePt: Number.isFinite(size) && size > 0 ? size : null,
    color: text(style.color),
    align:
      align === 'left' || align === 'center' || align === 'right' || align === 'justify'
        ? align
        : null,
  };
}
