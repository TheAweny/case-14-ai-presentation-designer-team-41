import { enablePatches, Immer, type Patch } from 'immer';
import {
  patchOpSchema,
  type Box,
  type Paragraph,
  type PatchOp,
  type SlideElement,
  type SlideIr,
} from '@lct/contracts';

// Patches stay off until asked for. Freezing is off too: a commit shares unchanged slides with
// the deck it was given, and the default freeze would make those slides read-only.
enablePatches();
const journal = new Immer({ autoFreeze: false });

/**
 * One committed editor change.
 *
 * `patches` replay the gesture, `inversePatches` are the undo. `ops` is what the engine applies
 * for the same gesture: one `move` or one `set-text`, never a step per pixel or character.
 * A deck-level change such as reordering slides carries no engine op.
 */
export interface DeckChange {
  /** Slide the engine ops belong to. Null when the change is the deck itself. */
  readonly slideId: string | null;
  readonly patches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
  readonly ops: readonly PatchOp[];
}

/** The deck after a commit. `change` is null when the slides were left as they were. */
export interface DeckCommit {
  readonly slides: readonly SlideIr[];
  readonly change: DeckChange | null;
}

/** Present slides plus the undo and redo stacks. The newest change is last in each stack. */
export interface DeckHistory {
  readonly slides: readonly SlideIr[];
  readonly undo: readonly DeckChange[];
  readonly redo: readonly DeckChange[];
}

interface Produced {
  readonly next: readonly SlideIr[];
  readonly patches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
}

function unchanged(slides: readonly SlideIr[]): DeckCommit {
  return { slides, change: null };
}

function produceSlides(slides: readonly SlideIr[], recipe: (draft: SlideIr[]) => void): Produced {
  const [next, patches, inversePatches] = journal.produceWithPatches(slides as SlideIr[], recipe);
  return { next, patches, inversePatches };
}

/**
 * Immer's patch values alias the objects they came from. The journal keeps its own copy, so a
 * later edit of the slide that was current at commit time cannot rewrite undo.
 */
function snapshotPatches(patches: readonly Patch[]): readonly Patch[] {
  return structuredClone(patches);
}

function elementOf(
  slides: readonly SlideIr[],
  slideId: string,
  elementId: string,
): SlideElement | undefined {
  return slides
    .find((slide) => slide.slideId === slideId)
    ?.elements.find((element) => element.elementId === elementId);
}

function commitProduced(
  slides: readonly SlideIr[],
  produced: Produced,
  slideId: string | null,
  ops: readonly PatchOp[],
): DeckCommit {
  if (produced.patches.length === 0) return unchanged(slides);
  return {
    slides: produced.next,
    change: {
      slideId,
      patches: snapshotPatches(produced.patches),
      inversePatches: snapshotPatches(produced.inversePatches),
      ops: ops.map((op) => patchOpSchema.parse(op)),
    },
  };
}

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
 * Write the final box of a drag. Call this once, when the pointer is released: the samples
 * along the way are not changes.
 */
export function commitMove(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementId: string; readonly box: Box },
): DeckCommit {
  const box = integralBox(change.box);
  const element = elementOf(slides, change.slideId, change.elementId);
  // A miss must not run produce: an empty recipe freezes the deck it was given.
  if (!element || sameBox(element.box, box)) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    if (!target) return;
    target.box = { ...box };
  });
  return commitProduced(slides, produced, change.slideId, [
    { op: 'move', elementId: change.elementId, box: { ...box } },
  ]);
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
  });
  return commitProduced(slides, produced, change.slideId, [
    { op: 'set-text', elementId: change.elementId, paragraphs: structuredClone(paragraphs) },
  ]);
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

  const produced = produceSlides(slides, (draft) => {
    const [moved] = draft.splice(fromIndex, 1);
    if (!moved) return;
    draft.splice(toIndex, 0, moved);
    for (const [index, slide] of draft.entries()) {
      if (slide.index !== index) slide.index = index;
    }
  });
  return commitProduced(slides, produced, null, []);
}

export function createDeckHistory(slides: readonly SlideIr[]): DeckHistory {
  return { slides, undo: [], redo: [] };
}

/** Push a commit onto the journal. A no-op commit leaves the history as it was and keeps redo. */
export function recordChange(history: DeckHistory, commit: DeckCommit): DeckHistory {
  if (!commit.change) return history;
  return {
    slides: commit.slides,
    undo: [...history.undo, commit.change],
    redo: [],
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
  };
}

export function redoDeck(history: DeckHistory): DeckHistory {
  const change = history.redo.at(-1);
  if (!change) return history;
  return {
    slides: applyChange(history.slides, change.patches),
    undo: [...history.undo, change],
    redo: history.redo.slice(0, -1),
  };
}
