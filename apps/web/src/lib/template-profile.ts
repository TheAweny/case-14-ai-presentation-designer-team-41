import type {
  ColorRef,
  ElementRole,
  Fill,
  Paragraph,
  PlaceholderRef,
  Shape,
  SlideElement,
  SlideIr,
  SlideLike,
  TemplateIr,
  TextRun,
} from '@lct/contracts';
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

/** Placeholder types the parser names for titles (lower-cased and hyphenated, as in the IR). */
const TITLE_TYPES = new Set(['title', 'center-title', 'vertical-title']);

/**
 * Placeholders PowerPoint fills from the header-and-footer settings of the presentation. A new
 * slide does not get them from its layout, so they are no frame to type into.
 */
const HEADER_FOOTER_TYPES = new Set(['date', 'footer', 'slide-number', 'header']);

/** What a placeholder inherits from on the master: titles, header and footer kinds, the rest. */
function familyOf(type: string): string {
  if (TITLE_TYPES.has(type)) return 'title';
  if (HEADER_FOOTER_TYPES.has(type)) return type;
  return 'body';
}

function roleOf(placeholder: PlaceholderRef | null): ElementRole {
  if (!placeholder) return 'body';
  if (TITLE_TYPES.has(placeholder.type)) return 'title';
  return placeholder.type === 'subtitle' ? 'subtitle' : 'body';
}

/** The master placeholder a layout placeholder follows: the same type, then the same family. */
function masterPlaceholderOf(placeholder: PlaceholderRef, master: SlideLike | undefined) {
  const candidates = (master?.shapes ?? []).filter((shape) => shape.placeholder !== null);
  return (
    candidates.find((shape) => shape.placeholder?.type === placeholder.type) ??
    candidates.find(
      (shape) => familyOf(shape.placeholder?.type ?? '') === familyOf(placeholder.type),
    )
  );
}

/** One layout slot per index, or per type when the file gives none. */
function placeholderKey(placeholder: PlaceholderRef): string {
  return placeholder.idx === null ? `type:${placeholder.type}` : `idx:${placeholder.idx}`;
}

/** Stated values of an object: a null, an empty string or an absent key means "inherited". */
function statedOf<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, field]) => field !== null && field !== ''),
  ) as Partial<T>;
}

const EMPTY_RUN: TextRun = {
  text: '',
  font: '',
  sizePt: null,
  bold: null,
  italic: null,
  color: '',
};

/**
 * The first paragraph of a placeholder with its words taken out. What it states wins over what
 * the master placeholder states; neither prompt ("Click to edit…", «Образец текста») survives:
 * it is a hint of the authoring tool, not text of the slide.
 */
function emptyParagraphOf(own: Paragraph | undefined, inherited: Paragraph | undefined): Paragraph {
  const run: TextRun = {
    ...EMPTY_RUN,
    ...statedOf(inherited?.runs[0]),
    ...statedOf(own?.runs[0]),
    text: '',
  };
  return {
    level: 0,
    lineSpacing: null,
    ...statedOf(inherited),
    ...statedOf(own),
    runs: [run],
  };
}

/**
 * A layout placeholder as the frame a new slide gets: where the layout or, failing that, the
 * master puts it, formatted as they format it, and empty.
 */
function placeholderFrameOf(
  shape: Shape,
  placeholder: PlaceholderRef,
  master: SlideLike | undefined,
  elementId: string,
): SlideElement | null {
  const inherited = masterPlaceholderOf(placeholder, master);
  const box = shape.box ?? inherited?.box;
  if (!box) return null;
  return {
    kind: 'text',
    elementId,
    role: roleOf(placeholder),
    box,
    sourceShapeId: shape.shapeId,
    paragraphs: [emptyParagraphOf(shape.paragraphs[0], inherited?.paragraphs[0])],
    overflow: null,
  };
}

function shapeOf(
  shape: Shape,
  owner: string,
  index: number,
  resolveColor: (color: ColorRef | null | undefined) => string | null,
): SlideElement | null {
  if (!shape.box) return null;
  const elementId = `template-${owner}-shape-${shape.shapeId}-${index}`;
  const hasText = shape.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.text.trim().length > 0),
  );
  if (hasText) {
    return {
      kind: 'text',
      elementId,
      role: roleOf(shape.placeholder),
      box: shape.box,
      sourceShapeId: shape.shapeId,
      paragraphs: shape.paragraphs,
      overflow: null,
    };
  }
  if (shape.placeholder) return null;
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

type Owner = 'master' | 'layout' | 'slide';

/** A box lying wholly past an edge of the slide; one touching the edge is still on it. */
function offCanvas(
  box: { x: number; y: number; cx: number; cy: number } | null | undefined,
  ir: TemplateIr,
): boolean {
  if (!box) return false;
  return box.x > ir.slideCx || box.y > ir.slideCy || box.x + box.cx < 0 || box.y + box.cy < 0;
}

/** Paint order of the parts: the master under the layout, the layout under the slide. */
const PAINT_ORDER: Record<Owner, number> = { master: 0, layout: 1, slide: 2 };

/**
 * A slide as PowerPoint paints it. The master and the layout contribute their graphics; their
 * placeholders are never drawn on their own. With `child` the slide is a real one and only its
 * own placeholders carry text. Without it the result is the blank a new slide starts from: the
 * layout's placeholders become empty frames, one per slot, with nothing of their prompts.
 */
function slideOf(
  layout: SlideLike,
  master: SlideLike | undefined,
  index: number,
  ir: TemplateIr,
  child: SlideLike | undefined = undefined,
): SlideIr {
  const resolveColor = colorResolver(ir, master, layout, child);
  const background =
    fillColor(child?.background, resolveColor) ??
    fillColor(layout.background, resolveColor) ??
    fillColor(master?.background, resolveColor);
  const shapes = [
    ...(master?.shapes ?? []).map((shape) => ({ shape, owner: 'master' as const })),
    ...layout.shapes.map((shape) => ({ shape, owner: 'layout' as const })),
    ...(child?.shapes ?? []).map((shape) => ({ shape, owner: 'slide' as const })),
  ].sort(
    (left, right) =>
      PAINT_ORDER[left.owner] - PAINT_ORDER[right.owner] || left.shape.z - right.shape.z,
  );
  const framesFrom: Owner = child ? 'slide' : 'layout';
  const slots = new Set<string>();
  const elements: SlideElement[] = [];
  shapes.forEach(({ shape, owner }, shapeIndex) => {
    if (shape.kind === 'group') return;
    // A master or a layout may keep a designer's rulers and notes past the slide edge; a show
    // never paints them, so the slide does not have them either.
    if (owner !== 'slide' && offCanvas(shape.box, ir)) return;
    const { placeholder } = shape;
    if (placeholder && owner !== framesFrom) return;
    if (placeholder && !child) {
      if (HEADER_FOOTER_TYPES.has(placeholder.type)) return;
      const key = placeholderKey(placeholder);
      if (slots.has(key)) return;
      slots.add(key);
      const frame = placeholderFrameOf(
        shape,
        placeholder,
        master,
        `template-${owner}-shape-${shape.shapeId}-${shapeIndex}`,
      );
      if (frame) elements.push(frame);
      return;
    }
    const element = shapeOf(shape, owner, shapeIndex, resolveColor);
    if (element) elements.push(element);
  });
  return {
    schemaVersion: 1,
    slideId: `template-layout-${index}`,
    variant: 'balanced',
    index,
    patternId: layout.part,
    slideCx: ir.slideCx,
    slideCy: ir.slideCy,
    elements,
    background,
  };
}

/**
 * The blanks a new slide starts from, one per layout of the template, in file order: master and
 * layout graphics and an empty frame on every layout placeholder.
 */
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
