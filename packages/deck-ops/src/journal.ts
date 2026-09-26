import type { Patch } from 'immer';
import {
  colorRoleSchema,
  slideElementSchema,
  type Box,
  type ColorRole,
  type ColorValue,
  type Paragraph,
  type PatchOp,
  type SlideElement,
  type SlideIr,
} from '@lct/contracts';
import {
  commitProduced,
  elementOf,
  journal,
  produceSlides,
  selectionOf,
  slideOf,
  unchanged,
  wordsOf,
  type DeckChange,
  type DeckCommit,
  type DeckHistory,
  type DeckSelection,
} from './core.js';
import { tidyLayers } from './layers.js';

export type { DeckChange, DeckChangeKind, DeckCommit, DeckHistory, DeckSelection } from './core.js';

function integralBox(box: Box): Box {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    cx: Math.round(box.cx),
    cy: Math.round(box.cy),
  };
}

function sameBox(left: Box, right: Box): boolean {
  return left.x === right.x && left.y === right.y && left.cx === right.cx && left.cy === right.cy;
}

function sameParagraphs(left: readonly Paragraph[], right: readonly Paragraph[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Write the final boxes of one drag or resize. Several elements share one journal entry.
 * Pointer samples along the way are not changes.
 */
export function commitMoves(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly moves: readonly { readonly elementId: string; readonly box: Box }[];
  },
): DeckCommit {
  const boxes = new Map<string, Box>();
  for (const move of change.moves) {
    const box = integralBox(move.box);
    const element = elementOf(slides, change.slideId, move.elementId);
    if (!element || sameBox(element.box, box)) continue;
    boxes.set(move.elementId, box);
  }
  if (boxes.size === 0) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    for (const [elementId, box] of boxes) {
      const target = elementOf(draft, change.slideId, elementId);
      if (!target) continue;
      target.box = { ...box };
    }
  });
  const moved = selectionOf(change.slideId, [...boxes.keys()]);
  return commitProduced(
    slides,
    produced,
    change.slideId,
    [...boxes].map(([elementId, box]) => ({
      op: 'move' as const,
      elementId,
      box: { ...box },
    })),
    { kind: 'move', before: moved, after: moved },
  );
}

/** One element of a drag. The same as `commitMoves` with a single box. */
export function commitMove(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementId: string; readonly box: Box },
): DeckCommit {
  return commitMoves(slides, {
    slideId: change.slideId,
    moves: [{ elementId: change.elementId, box: change.box }],
  });
}

/**
 * Fold every sample of one drag into a single `move`. The journal records the last box only.
 */
export function commitMoveGesture(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly samples: readonly Box[];
  },
): DeckCommit {
  const box = change.samples.at(-1);
  if (!box) return unchanged(slides);
  return commitMove(slides, {
    slideId: change.slideId,
    elementId: change.elementId,
    box,
  });
}

/**
 * Replace the copy of one text element. Call this once, when the text editor closes:
 * the keystrokes belong to that editor, not to the deck journal.
 *
 * The engine measured the overflow of the old copy, so the flag goes back to null: a stale mark
 * on new words is worse than none until the engine measures again.
 */
export function commitSetText(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly paragraphs: readonly Paragraph[];
  },
): DeckCommit {
  const paragraphs = structuredClone(change.paragraphs) as Paragraph[];
  const element = elementOf(slides, change.slideId, change.elementId);
  if (!element || element.kind !== 'text' || sameParagraphs(element.paragraphs, paragraphs)) {
    return unchanged(slides);
  }
  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    if (!target || target.kind !== 'text') return;
    target.paragraphs = structuredClone(paragraphs) as Paragraph[];
    if (target.overflow !== null) target.overflow = null;
  });
  const edited = selectionOf(change.slideId, [change.elementId]);
  return commitProduced(
    slides,
    produced,
    change.slideId,
    [{ op: 'set-text', elementId: change.elementId, paragraphs: structuredClone(paragraphs) }],
    { kind: 'text', before: edited, after: edited },
  );
}

/**
 * Fold every draft of one text-editing session into a single `set-text`.
 * The journal records the last draft only.
 */
export function commitSetTextGesture(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly drafts: readonly (readonly Paragraph[])[];
  },
): DeckCommit {
  const paragraphs = change.drafts.at(-1);
  if (!paragraphs) return unchanged(slides);
  return commitSetText(slides, {
    slideId: change.slideId,
    elementId: change.elementId,
    paragraphs,
  });
}

/** Type sizes an editor may set, in points: any value, not only the steps of the type scale. */
export const FONT_SIZE_PT = { min: 1, max: 1000 } as const;

/**
 * Set one size, in points, on every existing run of a text element or of the text in a shape. Any positive size is taken,
 * clamped to [`FONT_SIZE_PT.min`, `FONT_SIZE_PT.max`] and rounded to hundredths.
 * Runs are not invented. One gesture is one `set-font-size`.
 */
export function commitSetFontSize(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementId: string; readonly sizePt: number },
): DeckCommit {
  if (!Number.isFinite(change.sizePt) || change.sizePt <= 0) return unchanged(slides);
  const clamped = Math.min(Math.max(change.sizePt, FONT_SIZE_PT.min), FONT_SIZE_PT.max);
  const sizePt = Math.round(clamped * 100) / 100;
  const element = elementOf(slides, change.slideId, change.elementId);
  const runs = (element ? (wordsOf(element) ?? []) : []).flatMap((paragraph) => paragraph.runs);
  if (!element || runs.length === 0 || runs.every((run) => run.sizePt === sizePt)) {
    return unchanged(slides);
  }

  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    for (const paragraph of (target && wordsOf(target)) ?? []) {
      for (const run of paragraph.runs) {
        run.sizePt = sizePt;
      }
    }
  });
  const edited = selectionOf(change.slideId, [change.elementId]);
  // The engine sizes the words of a text element; the text in a shape travels with the slide.
  const ops: PatchOp[] =
    element.kind === 'text' ? [{ op: 'set-font-size', elementId: change.elementId, sizePt }] : [];
  return commitProduced(slides, produced, change.slideId, ops, {
    kind: 'font-size',
    before: edited,
    after: edited,
  });
}

const HEX = /^[0-9a-fA-F]{6}$/;

/**
 * The colour of `commitSetColor`: `color`, a palette role or a hex a user chose, or the older
 * `colorRole`. `hex` is what the runs are painted with; for a hex `color` it is that hex.
 */
export type SetColorChange = {
  readonly slideId: string;
  readonly elementId: string;
  readonly hex: string;
} & (
  | { readonly color: ColorValue; readonly colorRole?: never }
  | { readonly colorRole: ColorRole; readonly color?: never }
);

/**
 * Set one color on every existing run of a text element or of the text in a shape.
 * For a role, the engine op names the role and not the hex: the hex is only how the slide looks
 * until export learns the role. A hex a user chose has no engine op: it travels with the slide.
 */
export function commitSetColor(slides: readonly SlideIr[], change: SetColorChange): DeckCommit {
  const color: ColorValue = change.color ?? change.colorRole;
  const hex = HEX.test(color) ? color : change.hex;
  if (!HEX.test(hex)) return unchanged(slides);
  const role = colorRoleSchema.safeParse(color);
  if (!role.success && !HEX.test(color)) return unchanged(slides);
  const element = elementOf(slides, change.slideId, change.elementId);
  const runs = (element ? (wordsOf(element) ?? []) : []).flatMap((paragraph) => paragraph.runs);
  if (!element || runs.length === 0 || runs.every((run) => run.color === hex)) {
    return unchanged(slides);
  }

  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    for (const paragraph of (target && wordsOf(target)) ?? []) {
      for (const run of paragraph.runs) {
        run.color = hex;
      }
    }
  });
  const edited = selectionOf(change.slideId, [change.elementId]);
  // `set-color` on a shape would repaint its fill: the words in a shape travel with the slide.
  const ops: PatchOp[] =
    role.success && element.kind === 'text'
      ? [{ op: 'set-color', elementId: change.elementId, colorRole: role.data }]
      : [];
  return commitProduced(slides, produced, change.slideId, ops, {
    kind: 'color',
    before: edited,
    after: edited,
  });
}

/**
 * Remove elements from one slide. Several elements share one journal entry, and undo puts
 * each back at its old place in the paint order.
 */
export function commitRemove(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementIds: readonly string[] },
): DeckCommit {
  const wanted = new Set(change.elementIds);
  const elements = slideOf(slides, change.slideId)?.elements ?? [];
  const removed = elements.filter((element) => wanted.has(element.elementId));
  if (removed.length === 0) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    // From the end, so the indices still to visit stay where they were.
    for (let index = target.elements.length - 1; index >= 0; index -= 1) {
      const element = target.elements[index];
      if (element && wanted.has(element.elementId)) target.elements.splice(index, 1);
    }
    // A group left with one member is no group, as in PowerPoint.
    tidyLayers(target);
  });
  const ids = removed.map((element) => element.elementId);
  return commitProduced(
    slides,
    produced,
    change.slideId,
    ids.map((elementId) => ({ op: 'remove' as const, elementId })),
    {
      kind: 'remove',
      before: selectionOf(change.slideId, ids),
      after: selectionOf(change.slideId, []),
    },
  );
}

export function parsedElements(elements: readonly SlideElement[]): readonly SlideElement[] | null {
  try {
    return elements.map((element) => slideElementSchema.parse(element));
  } catch {
    return null;
  }
}

/** A text element with no words yet: what the text tool puts down before the first keystroke. */
function isEmptyText(element: SlideElement): boolean {
  return (
    element.kind === 'text' &&
    element.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text === ''))
  );
}

/**
 * Append elements to one slide, in paint order, above what is already there, keeping the ids the
 * caller gave. The engine has no insert operation, so the entry names the slide and carries no
 * ops. Elements are cloned inside the recipe: the next slides must not alias the caller's objects.
 *
 * A single empty text element is marked pending: its first edit folds into this entry (see
 * `recordChange`).
 */
export function commitInsert(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elements: readonly SlideElement[] },
): DeckCommit {
  if (change.elements.length === 0) return unchanged(slides);
  const existing = slideOf(slides, change.slideId);
  if (!existing) return unchanged(slides);

  const inserted = parsedElements(change.elements);
  if (!inserted) return unchanged(slides);
  const taken = new Set(existing.elements.map((element) => element.elementId));
  const ids = inserted.map((element) => element.elementId);
  if (ids.some((id) => taken.has(id)) || new Set(ids).size !== ids.length) {
    return unchanged(slides);
  }

  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    for (const element of structuredClone(inserted)) {
      target.elements.push(element);
    }
  });
  const [only] = inserted;
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'insert',
    before: selectionOf(change.slideId, []),
    after: selectionOf(change.slideId, ids),
    pendingText: inserted.length === 1 && only && isEmptyText(only) ? only.elementId : null,
  });
}

/**
 * Move a slide to another position in the deck and renumber `index`.
 * This is not a `PatchOp`: the engine has no reorder operation.
 */
export function reorderSlides(
  slides: readonly SlideIr[],
  fromIndex: number,
  toIndex: number,
): DeckCommit {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return unchanged(slides);
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= slides.length || toIndex >= slides.length) {
    return unchanged(slides);
  }
  if (fromIndex === toIndex) return unchanged(slides);

  const moved = slides[fromIndex]?.slideId ?? null;
  const produced = produceSlides(slides, (draft) => {
    const [slide] = draft.splice(fromIndex, 1);
    if (!slide) return;
    draft.splice(toIndex, 0, slide);
    for (const [index, item] of draft.entries()) {
      if (item.index !== index) item.index = index;
    }
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-order',
    before: selectionOf(moved, []),
    after: selectionOf(moved, []),
  });
}

export function createDeckHistory(slides: readonly SlideIr[]): DeckHistory {
  return { slides, undo: [], redo: [], restored: null };
}

/**
 * Two changes as one: the patches of the first then the second, undone in the opposite order.
 * The entry keeps the kind and the selection before of the first, and the selection after of
 * the second.
 */
export function mergeChanges(earlier: DeckChange, later: DeckChange): DeckChange {
  return {
    slideId: earlier.slideId === later.slideId ? earlier.slideId : null,
    patches: [...earlier.patches, ...later.patches],
    inversePatches: [...later.inversePatches, ...earlier.inversePatches],
    ops: [...earlier.ops, ...later.ops],
    kind: earlier.kind,
    before: earlier.before,
    after: later.after,
    pendingText: null,
    ...(later.series !== undefined ? { series: later.series } : null),
  };
}

export interface RecordOptions {
  /** Fold this change into the newest entry, so one undo takes both back. */
  readonly merge?: boolean;
  /** The selection undo should bring back, when the caller knows it better than the change. */
  readonly before?: DeckSelection | null;
  /** The selection redo should bring back. */
  readonly after?: DeckSelection | null;
  /**
   * A run of changes the caller sees as one gesture, such as arrow nudges without a pause. The
   * change folds into the newest entry when that entry is of the same series; any other change
   * in between ends the run.
   */
  readonly series?: string;
}

/**
 * How many steps undo keeps. Every entry holds its patches, so an unbounded journal would grow
 * for the whole session; the oldest steps go first.
 */
export const JOURNAL_LIMIT = 200;

function capped(undo: readonly DeckChange[]): readonly DeckChange[] {
  return undo.length > JOURNAL_LIMIT ? undo.slice(undo.length - JOURNAL_LIMIT) : undo;
}

function onlyElement(change: DeckChange, elementId: string): boolean {
  return (
    change.after?.elementIds.length === 1 &&
    change.after.elementIds[0] === elementId &&
    change.ops.every((op) => 'elementId' in op && op.elementId === elementId)
  );
}

/**
 * Push a commit onto the journal. A no-op commit leaves the history as it was and keeps redo.
 *
 * Right after an empty text element was inserted, its first `text` change folds into the insert
 * entry, and removing it drops the insert entry altogether: a text box put down and left empty
 * leaves no step behind.
 */
export function recordChange(
  history: DeckHistory,
  commit: DeckCommit,
  options: RecordOptions = {},
): DeckHistory {
  if (!commit.change) return history;
  const change: DeckChange = {
    ...commit.change,
    ...(options.before !== undefined ? { before: options.before } : null),
    ...(options.after !== undefined ? { after: options.after } : null),
    ...(options.series !== undefined ? { series: options.series } : null),
  };
  const last = history.undo.at(-1);
  const pending = last?.pendingText ?? null;
  if (last && pending !== null && last.slideId === change.slideId) {
    if (change.kind === 'text' && onlyElement(change, pending)) {
      return {
        slides: commit.slides,
        undo: [...history.undo.slice(0, -1), mergeChanges(last, change)],
        redo: [],
        restored: null,
      };
    }
    if (change.kind === 'remove' && change.before?.elementIds.join('\0') === pending) {
      return { slides: commit.slides, undo: history.undo.slice(0, -1), redo: [], restored: null };
    }
  }
  const continues = options.series !== undefined && last?.series === options.series;
  if ((options.merge || continues) && last) {
    return {
      slides: commit.slides,
      undo: [...history.undo.slice(0, -1), mergeChanges(last, change)],
      redo: [],
      restored: null,
    };
  }
  return {
    slides: commit.slides,
    undo: capped([...history.undo, change]),
    redo: [],
    restored: null,
  };
}

function applyChange(slides: readonly SlideIr[], patches: readonly Patch[]): readonly SlideIr[] {
  return journal.applyPatches(slides as SlideIr[], patches as Patch[]);
}

export function undoDeck(history: DeckHistory): DeckHistory {
  const change = history.undo.at(-1);
  if (!change) return history;
  return {
    slides: applyChange(history.slides, change.inversePatches),
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, change],
    restored: change.before,
  };
}

export function redoDeck(history: DeckHistory): DeckHistory {
  const change = history.redo.at(-1);
  if (!change) return history;
  return {
    slides: applyChange(history.slides, change.patches),
    undo: [...history.undo, change],
    redo: history.redo.slice(0, -1),
    restored: change.after,
  };
}
