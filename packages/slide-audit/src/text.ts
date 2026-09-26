import type {
  Box,
  DesignSystem,
  Paragraph,
  SlideElement,
  TextRun,
  TypeStyle,
} from '@lct/contracts';
import { EMU_PER_PT, createTypeResolver, typeRoleOf } from '@lct/slide-renderer';
import { outline, type Polygon } from './geometry.js';
import type { AuditContext } from './types.js';

export type TextElement = Extract<SlideElement, { kind: 'text' }>;

export function textOf(paragraphs: readonly Paragraph[]): string {
  return paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

export function isBlank(paragraphs: readonly Paragraph[]): boolean {
  return textOf(paragraphs).trim() === '';
}

/** What a person reads or looks at, as opposed to decoration. Empty text shows nothing. */
export function isContent(element: SlideElement): boolean {
  if (element.kind === 'decor') return false;
  if (element.kind === 'text') return !isBlank(element.paragraphs);
  return true;
}

/** The type style a text element inherits from, as the renderer picks it. */
export function typeStyleOf(
  designSystem: DesignSystem,
  element: Pick<SlideElement, 'role'>,
): TypeStyle | undefined {
  const role = typeRoleOf(element.role);
  return designSystem.typeScale.find((style) => style.role === role);
}

/** How one run is set on the slide: the run's own value, then its type style, as the renderer. */
export interface RunLook {
  readonly font: string;
  readonly sizePt: number;
  readonly bold: boolean;
}

export function runLook(
  run: TextRun,
  element: Pick<SlideElement, 'role'>,
  designSystem: DesignSystem,
  slideCy: number,
): RunLook {
  const style = typeStyleOf(designSystem, element);
  const type = createTypeResolver(designSystem, slideCy);
  const typeSizeEmu = type.sizeEmu(element.role);
  return {
    font: (run.font || style?.font || '').trim(),
    sizePt: run.sizePt ?? style?.sizePt ?? (typeSizeEmu > 0 ? typeSizeEmu / EMU_PER_PT : 16),
    bold: run.bold ?? style?.bold ?? type.bold(element.role),
  };
}

/**
 * Where the words of a text element actually are. With a measurement, the box is cut down, or
 * stretched, to the height of the text, anchored as the element is; without one it is the box.
 * Two text boxes whose empty lower halves overlap are not a problem anybody can see.
 */
export function textBox(element: TextElement, slideId: string, context: AuditContext): Box {
  const height = context.textHeight?.(slideId, element.elementId);
  if (height === undefined || !Number.isFinite(height) || isBlank(element.paragraphs)) {
    return element.box;
  }
  const { box } = element;
  const cy = Math.max(0, Math.round(height));
  const anchor = element.verticalAlign ?? 'top';
  const y =
    anchor === 'top'
      ? box.y
      : anchor === 'bottom'
        ? box.y + box.cy - cy
        : Math.round(box.y + (box.cy - cy) / 2);
  return { x: box.x, y, cx: box.cx, cy };
}

/** The outline an element occupies, its measured text in place of the box for text. */
export function footprint(element: SlideElement, slideId: string, context: AuditContext): Polygon {
  const box = element.kind === 'text' ? textBox(element, slideId, context) : element.box;
  return outline(box, element.rotation ?? 0);
}
