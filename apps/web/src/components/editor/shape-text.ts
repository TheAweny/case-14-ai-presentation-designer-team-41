import type { CSSProperties } from 'react';
import type { DesignSystem, SlideElement, VerticalAlign } from '@lct/contracts';
import {
  EMU_PER_PT,
  SHAPE_TEXT_ROLE,
  decorFill,
  holdsText,
  shapeTextLook,
  shapeTextPadding,
  type SlideSize,
} from '@lct/slide-renderer';
import type { ShapeTextFrame } from '@/components/editor/text-editor';

type DecorElement = Extract<SlideElement, { kind: 'decor' }>;
type TextElement = Extract<SlideElement, { kind: 'text' }>;

/**
 * Текст в фигуре (F-24): двойной клик или Enter по прямоугольнику, эллипсу, треугольнику
 * открывают тот же набор, что у текстового блока. Здесь — чистая часть: какая фигура держит
 * текст и как поле набора встаёт в неё.
 */

/** Фигура, в которую можно писать: замкнутая и не заблокированная. Линия текста не держит. */
export function canHoldText(element: SlideElement | undefined): element is DecorElement {
  return element?.kind === 'decor' && holdsText(element) && element.locked !== true;
}

/**
 * Фигура глазами поля набора: текстовый блок в её рамке с её абзацами. У пустой фигуры —
 * один пустой абзац, куда встанет каретка.
 */
export function shapeAsText(shape: DecorElement): TextElement {
  return {
    kind: 'text',
    elementId: shape.elementId,
    role: SHAPE_TEXT_ROLE,
    box: shape.box,
    sourceShapeId: shape.sourceShapeId,
    paragraphs: shape.paragraphs ?? [{ level: 0, runs: [], lineSpacing: null }],
    overflow: null,
  };
}

const ANCHOR: Record<VerticalAlign, CSSProperties['justifyContent']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/**
 * Как поле встаёт в фигуру: те же поля и якорь, что у текста фигуры на слайде (по умолчанию
 * по центру в обе стороны, как в PowerPoint), и тот же унаследованный вид.
 */
export function shapeTextFrame(
  shape: DecorElement,
  size: SlideSize,
  profile: DesignSystem,
): ShapeTextFrame {
  const look = shapeTextLook(profile, size.cy, decorFill(shape, size, profile));
  return {
    look: {
      fontFamily: look.fontFamily,
      sizePt: look.sizeEmu / EMU_PER_PT,
      bold: look.bold,
      italic: look.italic,
      lineHeight: look.lineHeight,
      color: look.color,
    },
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: ANCHOR[shape.verticalAlign ?? 'middle'],
      textAlign: 'center',
      boxSizing: 'border-box',
      ...shapeTextPadding(shape, size),
    },
  };
}
