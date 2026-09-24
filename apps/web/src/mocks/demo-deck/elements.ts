import type {
  Box,
  ColorRole,
  ElementRole,
  Paragraph,
  SlideElement,
  TextRun,
  TypeRole,
  TypeStyle,
} from '@lct/contracts';
import { DEMO_DESIGN_SYSTEM } from './design-system';

/**
 * Сборщики элементов SlideIR. Оформление текста берётся из дизайн-системы по роли, как это
 * сделала бы вёрстка: в самих слайдах нет ни шрифтов, ни кеглей, ни цветов.
 */

export type TextElement = Extract<SlideElement, { kind: 'text' }>;
export type ImageElement = Extract<SlideElement, { kind: 'image' }>;
export type TableElement = Extract<SlideElement, { kind: 'table' }>;
export type ChartElement = Extract<SlideElement, { kind: 'chart' }>;
export type DecorElement = Extract<SlideElement, { kind: 'decor' }>;

function typeStyle(role: TypeRole): TypeStyle {
  const style = DEMO_DESIGN_SYSTEM.typeScale.find((entry) => entry.role === role);
  if (!style) throw new Error(`Demo design system has no type style for ${role}`);
  return style;
}

function colorHex(role: ColorRole): string {
  const entry = DEMO_DESIGN_SYSTEM.palette.find((color) => color.role === role);
  if (!entry) throw new Error(`Demo design system has no colour for ${role}`);
  return entry.hex;
}

export interface RunOptions {
  /** Цвет по роли палитры, если не тот, что у стиля: текст на акцентной плашке, выделение. */
  color?: ColorRole;
  bold?: boolean;
  /** Крупнее шкалы — только заголовки титульного слайда, раздела и финала. */
  sizePt?: number;
}

export function run(text: string, style: TypeRole, options: RunOptions = {}): TextRun {
  const base = typeStyle(style);
  return {
    text,
    font: base.font,
    sizePt: options.sizePt ?? base.sizePt,
    bold: options.bold ?? base.bold,
    italic: base.italic,
    color: colorHex(options.color ?? base.colorRole),
  };
}

/** Абзац из одного прогона или из готовых прогонов, если в нём смешано оформление. */
export function para(
  style: TypeRole,
  content: string | TextRun[],
  options: RunOptions & { level?: number } = {},
): Paragraph {
  const { level = 0, ...runOptions } = options;
  return {
    level,
    runs: typeof content === 'string' ? [run(content, style, runOptions)] : content,
  };
}

export function text(
  elementId: string,
  role: ElementRole,
  box: Box,
  paragraphs: Paragraph[],
  sourceShapeId: number | null,
): TextElement {
  return { kind: 'text', elementId, role, box, sourceShapeId, paragraphs, overflow: null };
}

/** Маркированный список: по абзацу на пункт. */
export function bullets(
  elementId: string,
  box: Box,
  items: (string | { text: string; level: number })[],
  sourceShapeId: number | null,
): TextElement {
  const paragraphs = items.map((item) =>
    typeof item === 'string'
      ? para('bullet', item)
      : para('bullet', item.text, { level: item.level }),
  );
  return text(elementId, 'bullet-list', box, paragraphs, sourceShapeId);
}

export function image(
  elementId: string,
  role: 'image' | 'logo',
  box: Box,
  mediaPart: string,
  fit: ImageElement['fit'],
  sourceShapeId: number | null,
): ImageElement {
  return { kind: 'image', elementId, role, box, sourceShapeId, mediaPart, fit };
}

/**
 * Фигура из шаблона без нашего содержимого: линейка, плашка, карточка. Вид и заливку шаблонный
 * decor не называет — так же, как их не знает парсер, — и рендерер выводит цвет из геометрии.
 * Фон слайда помечается `locked`: случайно сдвинуть подложку нельзя.
 */
export function decor(
  elementId: string,
  box: Box,
  sourceShapeId: number,
  look: { readonly locked?: boolean } = {},
): DecorElement {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box,
    sourceShapeId,
    ...(look.locked ? { locked: true } : null),
  };
}
