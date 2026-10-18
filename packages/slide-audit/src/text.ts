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

/** Roles the template places around the content rather than as content itself. */
const FURNITURE_ROLES: ReadonlySet<string> = new Set([
  'logo',
  'footer',
  'page-number',
  'decoration',
]);

/**
 * Where an import takes a picture from is in its id: the layout's and the master's are the
 * template's own artwork (`layout-12`), a slide's own is `slide-7`. The engine reads it the same.
 */
const TEMPLATE_ART = /^(layout|master)-/;

/**
 * What a person reads or looks at, as opposed to decoration and the template's own furniture:
 * its logos, footers, page numbers and the pictures its layout draws. Empty text shows nothing.
 */
export function isContent(element: SlideElement): boolean {
  if (element.kind === 'decor' || FURNITURE_ROLES.has(element.role)) return false;
  if (element.kind === 'image' && TEMPLATE_ART.test(element.elementId)) return false;
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
 * Share of the type size one character is taken to be wide when nothing was measured: more than
 * the average letter of a sans or a serif, Cyrillic included, so an estimate errs on the wide side.
 */
const CHAR_EM = 0.62;
/** Room left for what the estimate cannot know: kerning, a wider typeface, a stand-in font. */
const ESTIMATE_SLACK = 1.25;

/**
 * How far the lines of a text element run across its box, estimated from the number of characters
 * and their size, or null when a line may fill the box: then it wraps, and the box is its extent.
 * Lines are placed as their paragraphs align them, inside the insets and the paragraph margin.
 */
export function estimatedExtent(
  element: TextElement,
  context: AuditContext,
): { x: number; cx: number } | null {
  const { box } = element;
  const insets = element.textInsets ?? { l: 0, t: 0, r: 0, b: 0 };
  const slideCy = context.designSystem.grid.slideCy;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const paragraph of element.paragraphs) {
    let width = 0;
    let largest = 0;
    for (const run of paragraph.runs) {
      const sizeEmu = runLook(run, element, context.designSystem, slideCy).sizePt * EMU_PER_PT;
      largest = Math.max(largest, sizeEmu);
      width += [...run.text].length * CHAR_EM * sizeEmu;
    }
    if (width === 0) continue;
    const bullet = paragraph.bullet ? largest : 0;
    width = (width + bullet) * ESTIMATE_SLACK;
    const start =
      box.x + insets.l + (paragraph.marginEmu ?? 0) + Math.min(0, paragraph.indentEmu ?? 0);
    const end = box.x + box.cx - insets.r;
    if (width >= end - start || paragraph.runs.some((run) => run.text.includes('\n'))) return null;
    const align = paragraph.align ?? 'left';
    const x =
      align === 'right'
        ? end - width
        : align === 'center'
          ? start + (end - start - width) / 2
          : start;
    left = Math.min(left, x);
    right = Math.max(right, x + width);
  }
  return right > left ? { x: Math.round(left), cx: Math.round(right - left) } : null;
}

/**
 * Where the words of a text element actually are. With a measurement, the box is cut down, or
 * stretched, to the height of the text, anchored as the element is, and narrowed to the width
 * its lines take; without one it is the box. Two text boxes whose empty lower halves overlap are
 * not a problem anybody can see, nor is the empty end of a box past the edge of the slide.
 */
export function textBox(element: TextElement, slideId: string, context: AuditContext): Box {
  const { box } = element;
  if (isBlank(element.paragraphs)) return box;
  const height = context.textHeight?.(slideId, element.elementId);
  const extent = context.textExtent?.(slideId, element.elementId);
  let { y, cy } = box;
  if (height !== undefined && Number.isFinite(height)) {
    cy = Math.max(0, Math.round(height));
    const anchor = element.verticalAlign ?? 'top';
    y =
      anchor === 'top'
        ? box.y
        : anchor === 'bottom'
          ? box.y + box.cy - cy
          : Math.round(box.y + (box.cy - cy) / 2);
  }
  const across =
    extent && Number.isFinite(extent.x) && Number.isFinite(extent.cx) && extent.cx > 0
      ? { x: Math.round(extent.x), cx: Math.round(extent.cx) }
      : { x: box.x, cx: box.cx };
  return { ...across, y, cy };
}

/** The outline an element occupies, its measured text in place of the box for text. */
export function footprint(element: SlideElement, slideId: string, context: AuditContext): Polygon {
  const box = element.kind === 'text' ? textBox(element, slideId, context) : element.box;
  return outline(box, element.rotation ?? 0);
}
