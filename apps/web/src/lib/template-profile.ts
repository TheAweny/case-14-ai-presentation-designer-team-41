import type { Fill, Shape, SlideLike, TemplateIr } from '@lct/contracts';
import type { SlideElement, SlideIr } from '@lct/contracts';
import type { SlideLayout } from './deck-source';

/** Convert a parser colour to the editor's literal-colour representation. */
function colorOf(shapeColor: { hex: string } | null | undefined): string | null {
  const hex = shapeColor?.hex?.replace(/^#/, '');
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? hex : null;
}

function fillColor(fill: Fill | null | undefined): string | null {
  return fill?.kind === 'solid' ? colorOf(fill.color) : null;
}

function shapeOf(shape: Shape, owner: string, index: number): SlideElement | null {
  if (!shape.box) return null;
  const elementId = `template-${owner}-shape-${shape.shapeId}-${index}`;
  const role = shape.placeholder?.type === 'title' ? 'title' : 'body';
  if (shape.paragraphs.length > 0) {
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
    fill: fillColor(shape.fill),
    stroke:
      shape.stroke?.visible && shape.stroke.color
        ? {
            color: colorOf(shape.stroke.color) ?? 'line',
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
): SlideIr {
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
      .map(({ shape, owner }, shapeIndex) => shapeOf(shape, owner, shapeIndex))
      .filter((element): element is SlideElement => element !== null),
    background:
      fillColor(child?.background) ?? fillColor(layout.background) ?? fillColor(master?.background),
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
  return slideOf(layout, master, index, ir, slide);
}
