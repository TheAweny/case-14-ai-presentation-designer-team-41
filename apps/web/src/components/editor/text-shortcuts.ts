import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import type { DesignSystem, ElementRole } from '@lct/contracts';
import { FONT_SIZE_PT, type ElementProps } from '@lct/deck-ops';
import { leadSizePt, textLook, typeSteps, type TextElement } from './inspector/text-model';
import type { FontSizeEntry } from './use-deck-history';
import {
  setParagraphAlign,
  setRangeSize,
  setRunFlag,
  stepParagraphLevel,
} from './active-text-editor';
import type { EditorCommand, KeyLike, TextFlag } from './editor-keymap';
import { sizeOf } from './text-document';

/**
 * Клавиши текста: Ctrl+B/I/U, выравнивание и кегль по шкале. Одно и то же сочетание правит
 * либо выделенные тексты целиком (одной записью журнала), либо фрагмент в открытом наборе.
 */

/** Ступени кегля шаблона по возрастанию, без повторов. */
export function sizeLadder(designSystem: DesignSystem): readonly number[] {
  const sizes = typeSteps(designSystem)
    .map((step) => step.sizePt)
    .filter((size) => Number.isFinite(size) && size > 0);
  return [...new Set(sizes)].sort((left, right) => left - right);
}

const EPSILON = 0.01;

/**
 * Следующий кегль по шкале шаблона, как Ctrl+Shift+> в Google Slides: ближайшая ступень
 * выше или ниже. За краем шкалы — шаг в десятую долю, но не меньше пункта.
 */
export function stepFontSize(current: number, ladder: readonly number[], step: -1 | 1): number {
  const next =
    step > 0
      ? ladder.find((size) => size > current + EPSILON)
      : [...ladder].reverse().find((size) => size < current - EPSILON);
  const fallback = current + step * Math.max(1, Math.round(current * 0.1));
  const value = next ?? fallback;
  return Math.min(Math.max(value, FONT_SIZE_PT.min), FONT_SIZE_PT.max);
}

/**
 * Свойство для Ctrl+B/I/U на выделенных текстах целиком: если флаг уже у всего текста —
 * снять, иначе поставить. Жирность от роли тоже считается: заголовок, жирный по шаблону,
 * первым нажатием становится обычным.
 */
export function flagProps(
  elements: readonly TextElement[],
  flag: TextFlag,
  designSystem: DesignSystem,
): ElementProps {
  const look = textLook(elements, designSystem);
  if (flag === 'underline') return { underline: !look.underline };
  return { [flag]: look[flag] !== true };
}

/** Кегль каждому тексту — на ступень от его собственного. */
export function sizeEntries(
  elements: readonly TextElement[],
  designSystem: DesignSystem,
  step: -1 | 1,
): FontSizeEntry[] {
  const ladder = sizeLadder(designSystem);
  return elements.flatMap((element) => {
    const current = leadSizePt(element, designSystem);
    if (current === null) return [];
    return [{ elementId: element.elementId, sizePt: stepFontSize(current, ladder, step) }];
  });
}

/** Что текст в наборе берёт от роли, если у фрагмента своего нет. */
export interface InheritedText {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly sizePt: number;
}

const ON = 'true';
const OFF = 'false';

/** Включён ли флаг у куска текста — своей меткой, явным режимом или от роли. */
function flagOn(marks: readonly Mark[], flag: TextFlag, inherited: InheritedText): boolean {
  const style = marks.find((mark) => mark.type.name === 'textStyle')?.attrs ?? {};
  if (flag === 'underline') return style.underlineMode === ON;
  if (marks.some((mark) => mark.type.name === flag)) return true;
  const mode = flag === 'bold' ? style.boldMode : style.italicMode;
  if (mode === OFF) return false;
  return mode === ON || inherited[flag];
}

/** Метки выделенных кусков, а у каретки — метки, с которыми пойдёт следующий символ. */
function rangePieces(editor: Editor): (readonly Mark[])[] {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const pieces: (readonly Mark[])[] = [];
  if (!empty) {
    state.doc.nodesBetween(from, to, (node) => {
      if (node.isText) pieces.push(node.marks);
    });
  }
  if (pieces.length === 0) pieces.push(state.storedMarks ?? state.selection.$from.marks());
  return pieces;
}

/** Флаг включён у всего выделенного (у каретки — у следующего символа), с учётом роли. */
export function rangeFlagOn(editor: Editor, flag: TextFlag, inherited: InheritedText): boolean {
  return rangePieces(editor).every((marks) => flagOn(marks, flag, inherited));
}

/** Ctrl+B/I/U в наборе: всё выделенное уже с флагом — снять, иначе поставить. */
export function toggleRangeFlag(editor: Editor, flag: TextFlag, inherited: InheritedText): void {
  setRunFlag(editor, flag, !rangeFlagOn(editor, flag, inherited));
}

/** Кегль фрагмента на ступень: от кегля начала выделения, свой он или от роли. */
export function stepRangeSize(
  editor: Editor,
  inherited: InheritedText,
  ladder: readonly number[],
  step: -1 | 1,
): void {
  const [first] = rangePieces(editor);
  const style = first?.find((mark) => mark.type.name === 'textStyle')?.attrs ?? {};
  const current = sizeOf(style.fontSize) ?? inherited.sizePt;
  setRangeSize(editor, stepFontSize(current, ladder, step));
}

/**
 * Команда клавиатуры в открытом наборе. `true` — команда текстовая и выполнена: событие
 * дальше не идёт, ни к меткам Tiptap, ни к браузеру (Ctrl+U в Chrome открыл бы исходник).
 */
export function runTextCommand(
  editor: Editor,
  command: EditorCommand,
  inherited: InheritedText,
  ladder: readonly number[],
): boolean {
  switch (command.kind) {
    case 'text-flag':
      toggleRangeFlag(editor, command.flag, inherited);
      return true;
    case 'text-align':
      setParagraphAlign(editor, command.align);
      return true;
    case 'text-size':
      stepRangeSize(editor, inherited, ladder, command.step);
      return true;
    case 'text-indent':
      stepParagraphLevel(editor, command.step);
      return true;
    default:
      return false;
  }
}

/**
 * У каких текстов Tab меняет уровень: список и основной текст. Заголовку, подписи, цифре KPI
 * уровни не нужны — там Tab просто не выходит из набора.
 */
export function canIndent(role: ElementRole): boolean {
  return role === 'bullet-list' || role === 'body';
}

/**
 * Символ, который клавиша напечатала бы: буква любой раскладки, цифра, знак. Null — клавиша не
 * печатает (стрелки, F-клавиши, Dead и Process у IME), идёт с Ctrl, Cmd или Alt, или это пробел:
 * пробел на холсте держит руку.
 */
export function typedText(event: KeyLike): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const { key } = event;
  if ([...key].length !== 1 || /\s|\p{C}/u.test(key)) return null;
  return key;
}
