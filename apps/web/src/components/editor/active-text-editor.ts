'use client';

import { useSyncExternalStore } from 'react';
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ParagraphAlign } from '@lct/contracts';
import {
  alignOf,
  colorOf,
  fontOf,
  letterSpacingOf,
  sizeOf,
  spacingOf,
  steppedLevel,
} from './text-document';

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
 * Куда может уйти фокус, не закрывая набор: полоса форматирования, текстовая секция панели,
 * их выпадающие меню и поповеры полей панели (пикер цвета, список шрифтов).
 * Всё остальное — конец набора.
 */
export const KEEPS_TEXT_FOCUS =
  '[data-text-format], [data-text-panel], [role="menu"], [data-inspector-popover]';

/** Поповер поля панели сам держит фокус: пикер тянут, в HEX и поиск шрифта печатают. */
const OWNS_FOCUS = '[data-inspector-popover]';

const ON = 'true';
const OFF = 'false';

/**
 * Цепочка команд набора. Каретка возвращается в текст, если фокус не в поповере поля:
 * иначе каждое движение пикера забирало бы у поповера фокус и закрывало его.
 */
function chainOf(editor: Editor): ChainedCommands {
  const chain = editor.chain();
  const focused = typeof document === 'undefined' ? null : document.activeElement;
  if (focused?.closest(OWNS_FOCUS)) return chain;
  return chain.focus();
}

/**
 * Жирный или курсив на выделении — явно, включая «выключено»: у заголовка жирность от роли,
 * и одно снятие метки её не отменило бы.
 */
export function setRunFlag(editor: Editor, flag: 'bold' | 'italic' | 'underline', on: boolean) {
  const chain = chainOf(editor);
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
  chainOf(editor).updateAttributes('paragraph', { align }).run();
}

/**
 * Уровень абзацев, которых касается выделение, на шаг глубже или мельче: Tab и Shift+Tab в
 * списке. Каждый абзац — от своего уровня, как в Google Slides.
 */
export function stepParagraphLevel(editor: Editor, step: -1 | 1) {
  chainOf(editor)
    .command(({ tr }) => {
      const { from, to } = tr.selection;
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph') return true;
        const level = steppedLevel(node.attrs.level, step);
        if (level !== node.attrs.level) tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
        return false;
      });
      return true;
    })
    .run();
}

/**
 * Межстрочный интервал абзацев, которых касается выделение: кратность одинарного
 * (1.2 = 120 %) поверх стиля роли. `null` — снова как у роли.
 */
export function setParagraphLineSpacing(editor: Editor, multiple: number | null) {
  const lineSpacing = multiple == null ? null : spacingOf(multiple);
  if (multiple != null && lineSpacing == null) return;
  chainOf(editor).updateAttributes('paragraph', { lineSpacing }).run();
}

/** Кегль фрагмента в пунктах, любой положительный. `null` — снова как у роли. */
export function setRangeSize(editor: Editor, sizePt: number | null) {
  if (sizePt == null) {
    chainOf(editor).unsetFontSize().run();
    return;
  }
  const points = sizeOf(sizePt);
  if (points == null) return;
  chainOf(editor).setFontSize(String(points)).run();
}

/**
 * Цвет фрагмента, любой hex: `#abc`, `abc`, `aabbcc`, `#AABBCC`. `null` — снова как у роли.
 * Неразборчивое значение ничего не меняет.
 */
export function setRangeColor(editor: Editor, hex: string | null) {
  if (hex == null) {
    chainOf(editor).unsetColor().run();
    return;
  }
  const six = sixDigitHex(hex);
  if (!six) return;
  chainOf(editor).setColor(`#${six}`).run();
}

/** Шрифт фрагмента по имени семейства. `null` или пустая строка — снова как у роли. */
export function setRangeFont(editor: Editor, family: string | null) {
  const name = fontOf(family ?? '');
  if (!name) {
    chainOf(editor).unsetFontFamily().run();
    return;
  }
  chainOf(editor).setFontFamily(name).run();
}

/**
 * Межбуквенный интервал фрагмента в пунктах (OOXML `spc`); ноль и отрицательный — тоже
 * значения. `null` — снова как у роли.
 */
export function setRangeLetterSpacing(editor: Editor, pt: number | null) {
  if (pt == null) {
    chainOf(editor).setMark('textStyle', { letterSpacing: null }).removeEmptyTextStyle().run();
    return;
  }
  if (!Number.isFinite(pt)) return;
  chainOf(editor)
    .setMark('textStyle', { letterSpacing: String(pt) })
    .run();
}

function sixDigitHex(value: string): string | null {
  const digits = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(digits)) return digits.toUpperCase();
  if (/^[0-9a-fA-F]{3}$/.test(digits)) {
    return [...digits]
      .map((digit) => digit + digit)
      .join('')
      .toUpperCase();
  }
  return null;
}

/** Поля фрагмента, которые на выделении могут расходиться. */
export type RangeField = 'sizePt' | 'color' | 'font' | 'letterSpacingPt' | 'lineSpacing';

/**
 * Что сейчас под кареткой или на выделении: сырые атрибуты, наследование считает панель.
 * У `sizePt`, `color`, `font`, `letterSpacingPt`, `lineSpacing` null значит «на фрагменте не
 * задано» или «разное по выделению»; разные перечислены в `mixed`.
 */
export interface RangeMarks {
  readonly bold: boolean;
  readonly boldMode: string | null;
  readonly italic: boolean;
  readonly italicMode: string | null;
  readonly underlineMode: string | null;
  readonly sizePt: number | null;
  /** `#RRGGBB`. */
  readonly color: string | null;
  readonly align: ParagraphAlign | null;
  /** Имя семейства без кавычек. */
  readonly font: string | null;
  readonly letterSpacingPt: number | null;
  /** Кратность одинарного интервала. */
  readonly lineSpacing: number | null;
  readonly mixed: readonly RangeField[];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

interface StyleValues {
  readonly sizePt: number | null;
  readonly color: string | null;
  readonly font: string | null;
  readonly letterSpacingPt: number | null;
}

function styleValues(attrs: Record<string, unknown>): StyleValues {
  const color = colorOf(attrs.color);
  return {
    sizePt: sizeOf(attrs.fontSize),
    color: color ? `#${color.toUpperCase()}` : null,
    font: fontOf(attrs.fontFamily) || null,
    letterSpacingPt: letterSpacingOf(attrs.letterSpacing),
  };
}

function textStyleAttrs(node: ProseMirrorNode): Record<string, unknown> {
  return node.marks.find((mark) => mark.type.name === 'textStyle')?.attrs ?? {};
}

/** Одно значение на все куски выделения, либо null и пометка «разное». */
function agree<Value>(values: readonly Value[]): { value: Value | null; mixed: boolean } {
  if (values.length === 0) return { value: null, mixed: false };
  const first = values[0] as Value;
  const mixed = values.some((value) => value !== first);
  return { value: mixed ? null : first, mixed };
}

export function rangeMarks(editor: Editor): RangeMarks {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const pieces: ProseMirrorNode[] = [];
  const paragraphs: ProseMirrorNode[] = [];
  if (empty) {
    paragraphs.push(state.selection.$from.parent);
  } else {
    state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === 'paragraph') paragraphs.push(node);
      if (node.isText) pieces.push(node);
    });
  }
  // Каретка или выделение без слов: метки, с которыми пойдёт следующий символ.
  const styles =
    pieces.length > 0
      ? pieces.map((node) => styleValues(textStyleAttrs(node)))
      : [styleValues(editor.getAttributes('textStyle'))];

  const mixed: RangeField[] = [];
  function pick<Key extends keyof StyleValues>(key: Key): StyleValues[Key] | null {
    const result = agree(styles.map((entry) => entry[key]));
    if (result.mixed) mixed.push(key);
    return result.value;
  }
  const sizePt = pick('sizePt');
  const color = pick('color');
  const font = pick('font');
  const letterSpacingPt = pick('letterSpacingPt');
  const spacing = agree(paragraphs.map((node) => spacingOf(node.attrs.lineSpacing)));
  if (spacing.mixed) mixed.push('lineSpacing');

  const style = editor.getAttributes('textStyle');
  const paragraph = editor.getAttributes('paragraph');
  return {
    bold: editor.isActive('bold'),
    boldMode: text(style.boldMode),
    italic: editor.isActive('italic'),
    italicMode: text(style.italicMode),
    underlineMode: text(style.underlineMode),
    sizePt,
    color,
    align: alignOf(paragraph.align),
    font,
    letterSpacingPt,
    lineSpacing: spacing.value,
    mixed,
  };
}
