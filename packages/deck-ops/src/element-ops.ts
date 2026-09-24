import type { Draft } from 'immer';
import {
  chartTypeSchema,
  colorRoleSchema,
  colorValueSchema,
  decorShapeSchema,
  imageFitSchema,
  paragraphAlignSchema,
  elementStrokeSchema,
  tableBordersSchema,
  verticalAlignSchema,
  type ChartType,
  type ColorValue,
  type DecorShape,
  type ImageFit,
  type ParagraphAlign,
  type PatchOp,
  type SlideElement,
  type SlideElementKind,
  type SlideIr,
  type ElementStroke,
  type TableBorders,
  type VerticalAlign,
} from '@lct/contracts';
import {
  commitProduced,
  elementOf,
  freshIds,
  produceSlides,
  randomId,
  selectionOf,
  slideOf,
  unchanged,
  unique,
  type DeckChangeKind,
  type DeckCommit,
} from './core.js';
import { parsedElements } from './journal.js';
import {
  arrangedLayers,
  flattenLayers,
  groupIdsOf,
  groupPath,
  layerTree,
  tidyLayers,
} from './layers.js';

/*
 * Properties
 * ----------
 */

/**
 * Everything the property panel can set on an element, beyond its box and its words.
 *
 * This is not a patch of the element object: only these fields exist, and each applies to the
 * kinds `ELEMENT_PROPS` lists for it. An element of another kind in the same selection keeps its
 * look, so one call can style a mixed selection.
 */
export interface ElementProps {
  /** Degrees clockwise. Any finite value, stored in [0, 360). */
  readonly rotation?: number;
  /** From 0 to 1; values outside are clamped. */
  readonly opacity?: number;
  readonly locked?: boolean;
  readonly shape?: DecorShape;
  /** A palette role or a hex a user chose (six digits, no hash), or null for no fill. */
  readonly fill?: ColorValue | null;
  /**
   * Merged over the stroke the shape has, so a width alone keeps each shape's colour. A shape
   * with no stroke needs a whole one. Null removes the outline. The colour is a role or a hex.
   */
  readonly stroke?: Partial<ElementStroke> | null;
  /** Share of the shorter side, clamped to [0, 0.5]. */
  readonly cornerRadius?: number;
  readonly flipH?: boolean;
  readonly flipV?: boolean;
  readonly fit?: ImageFit;
  readonly chartType?: ChartType;
  /** Every paragraph of a text element. Null goes back to the inherited alignment. */
  readonly align?: ParagraphAlign | null;
  readonly verticalAlign?: VerticalAlign;
  /** Every run of a text element. Null goes back to what the type role says. */
  readonly bold?: boolean | null;
  readonly italic?: boolean | null;
  readonly underline?: boolean | null;
  /** Typeface of every run of a text element. Null or blank goes back to the type role's face. */
  readonly fontFamily?: string | null;
  /**
   * Extra space between letters of every run, in points, clamped to
   * [`LETTER_SPACING_PT.min`, `LETTER_SPACING_PT.max`]. Null goes back to the inherited spacing.
   */
  readonly letterSpacingPt?: number | null;
  /**
   * Line spacing of every paragraph as a multiple of single spacing, clamped to
   * [`LINE_SPACING.min`, `LINE_SPACING.max`]. Null goes back to what the type role says.
   */
  readonly lineSpacing?: number | null;
  /** Whether the first row of a table looks like a header. */
  readonly headerRow?: boolean;
  /** Whether every other body row of a table is tinted. */
  readonly bandedRows?: boolean;
  /** Fill of the tinted rows: a role or a hex. Null goes back to the default. */
  readonly bandFill?: ColorValue | null;
  /**
   * Rules of a table, merged over the ones it states. A table that states none needs whole
   * rules. Null draws no lines at all.
   */
  readonly borders?: Partial<TableBorders> | null;
}

export type ElementProp = keyof ElementProps;

const LOOK = ['rotation', 'opacity', 'locked'] as const satisfies readonly ElementProp[];

/** Which properties each kind takes. The panel shows a control only where it applies. */
export const ELEMENT_PROPS: Readonly<Record<SlideElementKind, readonly ElementProp[]>> = {
  text: [
    ...LOOK,
    'align',
    'verticalAlign',
    'bold',
    'italic',
    'underline',
    'fontFamily',
    'letterSpacingPt',
    'lineSpacing',
  ],
  image: [...LOOK, 'fit'],
  table: [...LOOK, 'headerRow', 'bandedRows', 'bandFill', 'borders'],
  chart: [...LOOK, 'chartType'],
  decor: [...LOOK, 'shape', 'fill', 'stroke', 'cornerRadius', 'flipH', 'flipV'],
};

type Mutable = Record<string, unknown>;

/** A key whose value is its default is left out, as the contract reads a missing key. */
function setOrDrop(target: Mutable, key: string, value: unknown, fallback: unknown): void {
  if (value === fallback) {
    if (key in target) delete target[key];
    return;
  }
  if (target[key] !== value) target[key] = value;
}

function normalRotation(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const turned = ((value % 360) + 360) % 360;
  // Two decimals are far below a pixel; beyond them a spin through 360 leaves float dust.
  const rounded = Math.round(turned * 100) / 100;
  return rounded >= 360 ? 0 : rounded;
}

function clamp(value: number, min: number, max: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(Math.max(value, min), max);
}

/** Letter spacing an editor may set, in points: from very tight to wide tracking. */
export const LETTER_SPACING_PT = { min: -50, max: 200 } as const;

/** Line spacing an editor may set, as a multiple of single spacing. */
export const LINE_SPACING = { min: 0.5, max: 5 } as const;

/** Two decimals: a dragged value lands on what the field shows, without float dust. */
function hundredths(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** `value` clamped and rounded, or null when it is not a number at all. */
function bounded(value: number, range: { readonly min: number; readonly max: number }) {
  const clamped = clamp(value, range.min, range.max);
  return clamped === null ? null : hundredths(clamped);
}

function applyLook(target: Draft<SlideElement>, props: ElementProps): void {
  const look = target as unknown as Mutable;
  if (props.rotation !== undefined) {
    const rotation = normalRotation(props.rotation);
    if (rotation !== null) setOrDrop(look, 'rotation', rotation, 0);
  }
  if (props.opacity !== undefined) {
    const opacity = clamp(props.opacity, 0, 1);
    if (opacity !== null) setOrDrop(look, 'opacity', opacity, 1);
  }
  if (props.locked !== undefined) setOrDrop(look, 'locked', props.locked === true, false);
}

function applyDecor(target: Draft<Extract<SlideElement, { kind: 'decor' }>>, props: ElementProps) {
  const decor = target as unknown as Mutable;
  if (props.shape !== undefined && decorShapeSchema.safeParse(props.shape).success) {
    if (target.shape !== props.shape) target.shape = props.shape;
  }
  if (props.fill !== undefined) {
    if (props.fill === null) {
      if (target.fill !== null) target.fill = null;
    } else if (colorValueSchema.safeParse(props.fill).success && target.fill !== props.fill) {
      target.fill = props.fill;
    }
  }
  if (props.stroke !== undefined) {
    if (props.stroke === null) {
      if (target.stroke !== null) target.stroke = null;
    } else {
      const merged = elementStrokeSchema.safeParse({
        ...(target.stroke ?? {}),
        ...props.stroke,
        ...(props.stroke.widthEmu !== undefined
          ? { widthEmu: Math.max(1, Math.round(props.stroke.widthEmu)) }
          : null),
      });
      if (merged.success && JSON.stringify(merged.data) !== JSON.stringify(target.stroke)) {
        target.stroke = merged.data;
      }
    }
  }
  if (props.cornerRadius !== undefined) {
    const radius = clamp(props.cornerRadius, 0, 0.5);
    if (radius !== null && target.cornerRadius !== radius) target.cornerRadius = radius;
  }
  if (props.flipH !== undefined) setOrDrop(decor, 'flipH', props.flipH === true, false);
  if (props.flipV !== undefined) setOrDrop(decor, 'flipV', props.flipV === true, false);
}

function applyText(target: Draft<Extract<SlideElement, { kind: 'text' }>>, props: ElementProps) {
  if (
    props.verticalAlign !== undefined &&
    verticalAlignSchema.safeParse(props.verticalAlign).success
  ) {
    if (target.verticalAlign !== props.verticalAlign) target.verticalAlign = props.verticalAlign;
  }
  const align = props.align;
  if (align !== undefined && (align === null || paragraphAlignSchema.safeParse(align).success)) {
    for (const paragraph of target.paragraphs) {
      setOrDrop(paragraph as unknown as Mutable, 'align', align, null);
    }
  }
  for (const key of ['bold', 'italic'] as const) {
    const value = props[key];
    if (value === undefined) continue;
    for (const run of target.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      if (run[key] !== value) run[key] = value;
    }
  }
  if (props.underline !== undefined) {
    for (const run of target.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      setOrDrop(run as unknown as Mutable, 'underline', props.underline, null);
    }
  }
  if (props.fontFamily !== undefined) {
    // The run states no face as an empty string, which is what the contract reads as inherited.
    const font = props.fontFamily?.trim() ?? '';
    for (const run of target.paragraphs.flatMap((paragraph) => paragraph.runs)) {
      if (run.font !== font) run.font = font;
    }
  }
  if (props.letterSpacingPt !== undefined) {
    const spacing =
      props.letterSpacingPt === null ? null : bounded(props.letterSpacingPt, LETTER_SPACING_PT);
    if (props.letterSpacingPt === null || spacing !== null) {
      for (const run of target.paragraphs.flatMap((paragraph) => paragraph.runs)) {
        setOrDrop(run as unknown as Mutable, 'letterSpacingPt', spacing, null);
      }
    }
  }
  if (props.lineSpacing !== undefined) {
    const spacing = props.lineSpacing === null ? null : bounded(props.lineSpacing, LINE_SPACING);
    if (props.lineSpacing === null || spacing !== null) {
      // The contract requires the key: null, not absent, is how a paragraph inherits it.
      for (const paragraph of target.paragraphs) {
        if (paragraph.lineSpacing !== spacing) paragraph.lineSpacing = spacing;
      }
    }
  }
}

function applyTable(target: Draft<Extract<SlideElement, { kind: 'table' }>>, props: ElementProps) {
  const table = target as unknown as Mutable;
  if (props.headerRow !== undefined) setOrDrop(table, 'headerRow', props.headerRow === true, true);
  if (props.bandedRows !== undefined) {
    setOrDrop(table, 'bandedRows', props.bandedRows === true, false);
  }
  if (props.bandFill !== undefined) {
    if (props.bandFill === null) setOrDrop(table, 'bandFill', null, null);
    else if (colorValueSchema.safeParse(props.bandFill).success) {
      setOrDrop(table, 'bandFill', props.bandFill, null);
    }
  }
  if (props.borders !== undefined) {
    if (props.borders === null) {
      if (target.borders !== null) target.borders = null;
    } else {
      const merged = tableBordersSchema.safeParse({
        ...(target.borders ?? {}),
        ...props.borders,
        ...(props.borders.widthEmu !== undefined
          ? { widthEmu: Math.max(1, Math.round(props.borders.widthEmu)) }
          : null),
      });
      if (merged.success && JSON.stringify(merged.data) !== JSON.stringify(target.borders)) {
        target.borders = merged.data;
      }
    }
  }
}

function propsKind(props: ElementProps): DeckChangeKind {
  const keys = (Object.keys(props) as ElementProp[]).filter((key) => props[key] !== undefined);
  if (keys.length > 0 && keys.every((key) => key === 'rotation')) return 'rotate';
  if (keys.length > 0 && keys.every((key) => key === 'locked')) return 'lock';
  return 'style';
}

/** Only the fields that apply to this kind, so nothing else can reach the element. */
function propsFor(kind: SlideElementKind, props: ElementProps): ElementProps {
  const allowed = new Set(ELEMENT_PROPS[kind]);
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(props) as ElementProp[]) {
    if (allowed.has(key) && props[key] !== undefined) picked[key] = props[key];
  }
  return picked as ElementProps;
}

/**
 * Set properties on one or more elements of a slide as one journal entry.
 *
 * Text whose paragraphs changed gets a `set-text` op and a shape whose fill became a role gets a
 * `set-color`, because the engine has those operations; a hex fill and the rest of the look travel
 * with the slide itself.
 */
export function commitElementProps(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementIds: readonly string[];
    readonly props: ElementProps;
  },
): DeckCommit {
  const ids = unique(change.elementIds).filter((id) => elementOf(slides, change.slideId, id));
  if (ids.length === 0) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    for (const id of ids) {
      const target = elementOf(draft, change.slideId, id);
      if (!target) continue;
      const props = propsFor(target.kind, change.props);
      applyLook(target, props);
      if (target.kind === 'decor') applyDecor(target, props);
      if (target.kind === 'text') applyText(target, props);
      if (target.kind === 'table') applyTable(target, props);
      if (target.kind === 'image' && props.fit !== undefined) {
        if (imageFitSchema.safeParse(props.fit).success && target.fit !== props.fit) {
          target.fit = props.fit;
        }
      }
      if (target.kind === 'chart' && props.chartType !== undefined) {
        if (chartTypeSchema.safeParse(props.chartType).success) {
          if (target.chartType !== props.chartType) target.chartType = props.chartType;
        }
      }
    }
  });
  const ops: PatchOp[] = [];
  for (const id of ids) {
    const before = elementOf(slides, change.slideId, id);
    const after = elementOf(produced.next, change.slideId, id);
    if (!before || !after) continue;
    if (
      before.kind === 'text' &&
      after.kind === 'text' &&
      JSON.stringify(before.paragraphs) !== JSON.stringify(after.paragraphs)
    ) {
      ops.push({ op: 'set-text', elementId: id, paragraphs: structuredClone(after.paragraphs) });
    }
    if (before.kind === 'decor' && after.kind === 'decor' && before.fill !== after.fill) {
      const role = colorRoleSchema.safeParse(after.fill);
      if (role.success) ops.push({ op: 'set-color', elementId: id, colorRole: role.data });
    }
  }
  const selected = selectionOf(change.slideId, ids);
  return commitProduced(slides, produced, change.slideId, ops, {
    kind: propsKind(change.props),
    before: selected,
    after: selected,
  });
}

/*
 * Copies
 * ------
 */

/** An offset in EMU for a copy placed over its original, so the two can be told apart. */
export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** A hundredth of the slide width: about ten points on a wide slide, a visible nudge. */
function defaultOffset(slide: SlideIr): Offset {
  const step = Math.round(slide.slideCx / 96);
  return { x: step, y: step };
}

function shifted<T extends SlideElement>(element: T, offset: Offset, elementId: string): T {
  const copy = structuredClone(element);
  copy.elementId = elementId;
  copy.box = {
    ...copy.box,
    x: Math.round(copy.box.x + offset.x),
    y: Math.round(copy.box.y + offset.y),
  };
  return copy;
}

/** The same element in the groups `renamed` maps to; a group it does not name keeps its id. */
function regrouped<T extends SlideElement>(element: T, renamed: ReadonlyMap<string, string>): T {
  const path = groupPath(element);
  if (path.length === 0) return element;
  return { ...element, groupIds: path.map((id) => renamed.get(id) ?? id) };
}

/**
 * Copy elements of a slide. The copies get new ids, shift by `offset` (a hundredth of the slide
 * width by default) and sit as one block right above the topmost original, in the originals'
 * paint order. Undo selects the originals, redo the copies.
 *
 * A group copied whole is a new group; a copy of part of a group joins that group, the way
 * duplicating inside a group works in Figma.
 */
export function commitDuplicate(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementIds: readonly string[];
    readonly offset?: Offset;
    readonly nextId?: () => string;
  },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const wanted = new Set(change.elementIds);
  const originals = slide.elements.filter((element) => wanted.has(element.elementId));
  if (originals.length === 0) return unchanged(slides);
  const offset = change.offset ?? defaultOffset(slide);
  const next = freshIds(
    [...slide.elements.map((element) => element.elementId), ...groupIdsOf(slide.elements)],
    change.nextId ?? randomId,
  );
  const copies: SlideElement[] = [];
  for (const original of originals) {
    const id = next();
    if (id === null) return unchanged(slides);
    copies.push(shifted(original, offset, id));
  }
  const renamed = new Map<string, string>();
  for (const groupId of groupIdsOf(originals)) {
    const members = slide.elements.filter((element) => groupPath(element).includes(groupId));
    if (!members.every((element) => wanted.has(element.elementId))) continue;
    const id = next();
    if (id === null) return unchanged(slides);
    renamed.set(groupId, id);
  }
  const top = Math.max(
    ...originals.map((original) => slide.elements.findIndex((item) => item === original)),
  );
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    target.elements.splice(
      top + 1,
      0,
      ...structuredClone(copies.map((copy) => regrouped(copy, renamed))),
    );
    tidyLayers(target);
  });
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'duplicate',
    before: selectionOf(
      change.slideId,
      originals.map((element) => element.elementId),
    ),
    after: selectionOf(
      change.slideId,
      copies.map((element) => element.elementId),
    ),
  });
}

/**
 * Put elements from the clipboard on a slide, above everything, with new ids. They may come from
 * any slide or deck, so each is checked against the contract first; one that fails stops the
 * paste. The offset, none by default, is the caller's: pasting onto the slide the elements came
 * from usually wants one, pasting elsewhere does not.
 */
export function commitPaste(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elements: readonly SlideElement[];
    readonly offset?: Offset;
    readonly nextId?: () => string;
  },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide || change.elements.length === 0) return unchanged(slides);
  const parsed = parsedElements(change.elements);
  if (!parsed) return unchanged(slides);
  const next = freshIds(
    [...slide.elements.map((element) => element.elementId), ...groupIdsOf(slide.elements)],
    change.nextId ?? randomId,
  );
  const offset = change.offset ?? { x: 0, y: 0 };
  const pasted: SlideElement[] = [];
  for (const element of parsed) {
    const id = next();
    if (id === null) return unchanged(slides);
    pasted.push(shifted(element, offset, id));
  }
  // Groups come along as new groups: the ones they had may mean something else on this slide.
  const renamed = new Map<string, string>();
  for (const groupId of groupIdsOf(parsed)) {
    const id = next();
    if (id === null) return unchanged(slides);
    renamed.set(groupId, id);
  }
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    target.elements.push(...structuredClone(pasted.map((element) => regrouped(element, renamed))));
    tidyLayers(target);
  });
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'paste',
    before: selectionOf(change.slideId, []),
    after: selectionOf(
      change.slideId,
      pasted.map((element) => element.elementId),
    ),
  });
}

/*
 * Paint order
 * -----------
 */

/** One step up or down the paint order, or all the way to the top or the bottom. */
export type ArrangeTarget = 'forward' | 'backward' | 'front' | 'back';

function arranged<T>(items: readonly T[], selected: (item: T) => boolean, to: ArrangeTarget): T[] {
  const order = [...items];
  if (to === 'front')
    return [...order.filter((item) => !selected(item)), ...order.filter(selected)];
  if (to === 'back') return [...order.filter(selected), ...order.filter((item) => !selected(item))];
  if (to === 'forward') {
    // From the top down, so a run of selected elements moves as a block.
    for (let index = order.length - 2; index >= 0; index -= 1) {
      const item = order[index];
      const above = order[index + 1];
      if (item !== undefined && above !== undefined && selected(item) && !selected(above)) {
        order[index] = above;
        order[index + 1] = item;
      }
    }
    return order;
  }
  for (let index = 1; index < order.length; index += 1) {
    const item = order[index];
    const below = order[index - 1];
    if (item !== undefined && below !== undefined && selected(item) && !selected(below)) {
      order[index] = below;
      order[index - 1] = item;
    }
  }
  return order;
}

/**
 * Move elements through the paint order of their slide. Stepping forward passes the next element
 * that is not selected; front and back keep the selected elements in their own order. Groups
 * are single steps: a selected group moves past whole groups, and an element inside a group
 * moves among its siblings there, up to the top or bottom of the group.
 */
export function commitArrange(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementIds: readonly string[];
    readonly to: ArrangeTarget;
  },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const wanted = new Set(change.elementIds);
  const picked = (element: SlideElement) => wanted.has(element.elementId);
  // Siblings move among siblings: a group moves as one, an element inside one stays inside it.
  const layers = arrangedLayers(layerTree(slide.elements), wanted, (items, pick) =>
    arranged(items, pick, change.to),
  );
  const ids = flattenLayers(layers).map((layer) => layer.elementId);
  if (ids.every((id, index) => id === slide.elements[index]?.elementId)) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    const byId = new Map(target.elements.map((element) => [element.elementId, element]));
    const next = ids.map((id) => byId.get(id)).filter((element) => element !== undefined);
    target.elements.splice(0, target.elements.length, ...next);
  });
  const selected = selectionOf(
    change.slideId,
    slide.elements.filter(picked).map((element) => element.elementId),
  );
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'arrange',
    before: selected,
    after: selected,
  });
}

/*
 * Pictures, tables and charts
 * ---------------------------
 */

type Kind<K extends SlideElementKind> = Extract<SlideElement, { kind: K }>;

/** One element of one kind, changed by `edit`; anything else leaves the deck as it was. */
function commitOne<K extends SlideElementKind>(
  slides: readonly SlideIr[],
  target: { readonly slideId: string; readonly elementId: string },
  kind: K,
  changeKind: DeckChangeKind,
  edit: (draft: Draft<Kind<K>>) => void,
): DeckCommit {
  const element = elementOf(slides, target.slideId, target.elementId);
  if (!element || element.kind !== kind) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const found = elementOf(draft, target.slideId, target.elementId);
    if (found && found.kind === kind) edit(found as Draft<Kind<K>>);
  });
  const selected = selectionOf(target.slideId, [target.elementId]);
  return commitProduced(slides, produced, target.slideId, [], {
    kind: changeKind,
    before: selected,
    after: selected,
  });
}

/** Point a picture at other media: an upload, or another part of the template. */
export function commitReplaceImage(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementId: string; readonly mediaPart: string },
): DeckCommit {
  const mediaPart = change.mediaPart.trim();
  if (!mediaPart) return unchanged(slides);
  return commitOne(slides, change, 'image', 'image', (image) => {
    if (image.mediaPart !== mediaPart) image.mediaPart = mediaPart;
  });
}

// Table operations live in their own module; these names stay reachable from here.
export {
  commitInsertTableColumn,
  commitInsertTableRow,
  commitRemoveTableColumn,
  commitRemoveTableRow,
  commitTableCell,
  type TableCell,
} from './table-ops.js';

export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
}

/**
 * Categories and series of a chart, replaced together so they always agree: every series needs a
 * name and one finite value per category, or nothing changes.
 */
export function commitChartData(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly categories: readonly string[];
    readonly series: readonly ChartSeries[];
  },
): DeckCommit {
  const { categories, series } = change;
  const valid =
    categories.length > 0 &&
    series.length > 0 &&
    series.every(
      (entry) =>
        entry.name.length > 0 &&
        entry.values.length === categories.length &&
        entry.values.every((value) => Number.isFinite(value)),
    );
  if (!valid) return unchanged(slides);
  return commitOne(slides, change, 'chart', 'chart', (chart) => {
    if (JSON.stringify(chart.categories) !== JSON.stringify(categories)) {
      chart.categories = [...categories];
    }
    const next = series.map((entry) => ({ name: entry.name, values: [...entry.values] }));
    if (JSON.stringify(chart.series) !== JSON.stringify(next)) chart.series = next;
  });
}

/** Axis titles of a chart. An empty string is no title. */
export function commitChartAxes(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly xTitle?: string;
    readonly yTitle?: string;
  },
): DeckCommit {
  return commitOne(slides, change, 'chart', 'chart', (chart) => {
    if (change.xTitle !== undefined && chart.xTitle !== change.xTitle) chart.xTitle = change.xTitle;
    if (change.yTitle !== undefined && chart.yTitle !== change.yTitle) chart.yTitle = change.yTitle;
  });
}
