import type { ColorRef, Fill, Shape, SlideLike, TemplateIr } from '@lct/contracts';
import type { SlideElement, SlideIr } from '@lct/contracts';
import type { SlideLayout } from './deck-source';

/** Convert a parser colour to the editor's literal-colour representation. */
function hexOf(value: string | null | undefined): string | null {
  const hex = value?.replace(/^#/, '');
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null;
}

function rgbOf(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function applyTransforms(hex: string, transforms: readonly [string, number][]): string {
  let [red, green, blue] = rgbOf(hex);
  for (const [name, value] of transforms) {
    const amount = Math.max(0, Math.min(value, 100_000)) / 100_000;
    if (name === 'tint' || name === 'lumOff') {
      red += (255 - red) * amount;
      green += (255 - green) * amount;
      blue += (255 - blue) * amount;
    } else if (name === 'shade' || name === 'lumMod') {
      red *= amount;
      green *= amount;
      blue *= amount;
    }
  }
  return [red, green, blue]
    .map((component) => Math.round(component).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function colorResolver(
  ir: TemplateIr,
  master: SlideLike | undefined,
  layout: SlideLike | undefined,
  slide: SlideLike | undefined,
): (color: ColorRef | null | undefined) => string | null {
  const aliases = new Map<string, string>(master?.colorMap);
  for (const [alias, target] of layout?.colorMap ?? []) aliases.set(alias, target);
  for (const [alias, target] of slide?.colorMap ?? []) aliases.set(alias, target);
  const theme = ir.themeColors.find((candidate) => candidate.part === master?.theme);
  const slots = new Map(theme?.slots);
  return (color) => {
    const literal = hexOf(color?.hex);
    if (literal) return applyTransforms(literal, color?.transforms ?? []);
    const slot = color?.scheme ? (aliases.get(color.scheme) ?? color.scheme) : '';
    const themed = hexOf(slots.get(slot));
    return themed ? applyTransforms(themed, color?.transforms ?? []) : null;
  };
}

function fillColor(
  fill: Fill | null | undefined,
  resolve: (color: ColorRef | null | undefined) => string | null,
): string | null {
  return fill?.kind === 'solid' ? resolve(fill.color) : null;
}

function shapeOf(
  shape: Shape,
  owner: string,
  index: number,
  resolveColor: (color: ColorRef | null | undefined) => string | null,
  showEmptyPlaceholder: boolean,
): SlideElement | null {
  if (!shape.box) return null;
  const elementId = `template-${owner}-shape-${shape.shapeId}-${index}`;
  const role = shape.placeholder?.type === 'title' ? 'title' : 'body';
  const hasText = shape.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.text.trim().length > 0),
  );
  if (
    hasText ||
    (showEmptyPlaceholder && shape.placeholder !== null && shape.paragraphs.length > 0)
  ) {
    return {
      kind: 'text',
      elementId,
      role,
      box: shape.box,
      sourceShapeId: shape.shapeId,
      paragraphs: shape.paragraphs,
      overflow: null,
    };
  }
  if (shape.placeholder && !showEmptyPlaceholder) return null;
  if (shape.mediaPart) {
    return {
      kind: 'image',
      elementId,
      role: 'image',
      box: shape.box,
      sourceShapeId: shape.shapeId,
      mediaPart: shape.mediaPart,
      fit: 'contain',
    };
  }
  const shapeName = shape.geometry === 'roundRect' ? 'round-rect' : shape.geometry;
  const allowedShape =
    shapeName === 'rect' ||
    shapeName === 'round-rect' ||
    shapeName === 'ellipse' ||
    shapeName === 'triangle' ||
    shapeName === 'diamond' ||
    shapeName === 'line'
      ? shapeName
      : undefined;
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: shape.box,
    sourceShapeId: shape.shapeId,
    ...(allowedShape ? { shape: allowedShape } : {}),
    fill: fillColor(shape.fill, resolveColor),
    stroke:
      shape.stroke?.visible && shape.stroke.color
        ? {
            color: resolveColor(shape.stroke.color) ?? 'line',
            widthEmu: Math.max(1, shape.stroke.widthEmu ?? 1),
            dash: 'solid',
            head: 'none',
            tail: 'none',
          }
        : null,
    flipH: shape.flipH,
    flipV: shape.flipV,
  };
}

function slideOf(
  layout: SlideLike,
  master: SlideLike | undefined,
  index: number,
  ir: TemplateIr,
  child: SlideLike | undefined = undefined,
  includeInheritedPlaceholders = true,
): SlideIr {
  const resolveColor = colorResolver(ir, master, layout, child);
  const background =
    fillColor(child?.background, resolveColor) ??
    fillColor(layout.background, resolveColor) ??
    fillColor(master?.background, resolveColor);
  const shapes = [
    ...(master?.shapes ?? []).map((shape) => ({ shape, owner: 'master' })),
    ...layout.shapes.map((shape) => ({ shape, owner: 'layout' })),
    ...(child?.shapes ?? []).map((shape) => ({ shape, owner: 'slide' })),
  ].sort((left, right) => left.shape.z - right.shape.z);
  return {
    schemaVersion: 1,
    slideId: `template-layout-${index}`,
    variant: 'balanced',
    index,
    patternId: layout.part,
    slideCx: ir.slideCx,
    slideCy: ir.slideCy,
    elements: shapes
      .filter(
        ({ shape, owner }) =>
          (includeInheritedPlaceholders || owner === 'slide' || shape.placeholder === null) &&
          shape.kind !== 'group',
      )
      .map(({ shape, owner }, shapeIndex) =>
        shapeOf(shape, owner, shapeIndex, resolveColor, includeInheritedPlaceholders),
      )
      .filter((element): element is SlideElement => element !== null),
    background,
  };
}

/** Preserve parser layouts and their measurable objects for the existing editor gallery. */
export function templateLayoutsFromIr(ir: TemplateIr): readonly SlideLayout[] {
  const masters = new Map(ir.masters.map((master) => [master.part, master]));
  return ir.layouts.map((layout, index) => ({
    name: layout.name || `Макет ${index + 1}`,
    slide: slideOf(layout, masters.get(layout.follows), index, ir),
  }));
}

/** Resolve one real uploaded slide with the same master/layout inheritance as the presentation. */
export function templateSlideFromIr(ir: TemplateIr, index = 0): SlideIr | null {
  const slide = ir.slides[index];
  if (!slide) return null;
  const layout = ir.layouts.find((candidate) => candidate.part === slide.follows);
  const master = layout
    ? ir.masters.find((candidate) => candidate.part === layout.follows)
    : undefined;
  if (!layout) {
    return slideOf(slide, undefined, index, ir);
  }
  return slideOf(layout, master, index, ir, slide, false);
}
