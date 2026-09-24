import { enablePatches, Immer, type Patch } from 'immer';
import { patchOpSchema, type PatchOp, type SlideElement, type SlideIr } from '@lct/contracts';

// Patches stay off until asked for. Freezing is off too: a commit shares unchanged slides with
// the deck it was given, and the default freeze would make those slides read-only.
enablePatches();
export const journal = new Immer({ autoFreeze: false });

/**
 * What a change did, in the words an undo button would use. Every commit names one, so the editor
 * never has to guess it from the engine ops, which most editor changes do not have.
 */
export type DeckChangeKind =
  | 'move'
  | 'text'
  | 'font-size'
  | 'color'
  | 'style'
  | 'rotate'
  | 'lock'
  | 'remove'
  | 'insert'
  | 'paste'
  | 'duplicate'
  | 'arrange'
  | 'image'
  | 'table'
  | 'chart'
  | 'slide-order'
  | 'slide-insert'
  | 'slide-duplicate'
  | 'slide-remove'
  | 'slide-background';

/** A slide and the elements selected on it. An empty list is a slide with nothing selected. */
export interface DeckSelection {
  readonly slideId: string | null;
  readonly elementIds: readonly string[];
}

/**
 * One committed editor change.
 *
 * `patches` replay the gesture, `inversePatches` are the undo. `ops` is what the engine applies
 * for the same gesture where the engine has an operation for it — one `move`, `set-text`,
 * `set-font-size`, `set-color` or `remove`, never a step per pixel or character. The rest of the
 * editor's changes carry no ops: the exported slide is the source of truth, and the ops are the
 * audit trail of the changes the engine can name.
 */
export interface DeckChange {
  /** Slide the change belongs to. Null when the change is the deck itself. */
  readonly slideId: string | null;
  readonly patches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
  readonly ops: readonly PatchOp[];
  readonly kind: DeckChangeKind;
  /** What undo selects again: the elements as they were picked before the change. */
  readonly before: DeckSelection | null;
  /** What redo selects again: the elements the change left behind. */
  readonly after: DeckSelection | null;
  /**
   * A text element this change inserted empty. Its first edit folds into this entry, so inserting
   * a text box and typing into it is one step of history, and removing it again is none.
   */
  readonly pendingText: string | null;
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
  /** The selection the latest undo or redo brings back. Null after any other step. */
  readonly restored: DeckSelection | null;
}

export interface Produced {
  readonly next: readonly SlideIr[];
  readonly patches: readonly Patch[];
  readonly inversePatches: readonly Patch[];
}

/** Everything about a change except its patches. */
export interface ChangeMeta {
  readonly kind: DeckChangeKind;
  readonly before: DeckSelection | null;
  readonly after: DeckSelection | null;
  readonly pendingText?: string | null;
}

export function unchanged(slides: readonly SlideIr[]): DeckCommit {
  return { slides, change: null };
}

export function produceSlides(
  slides: readonly SlideIr[],
  recipe: (draft: SlideIr[]) => void,
): Produced {
  const [next, patches, inversePatches] = journal.produceWithPatches(slides as SlideIr[], recipe);
  return { next, patches, inversePatches };
}

/**
 * Immer's patch values alias the objects they came from. The journal keeps its own copy, so a
 * later edit of the slide that was current at commit time cannot rewrite undo.
 */
export function snapshotPatches(patches: readonly Patch[]): readonly Patch[] {
  return structuredClone(patches);
}

export function commitProduced(
  slides: readonly SlideIr[],
  produced: Produced,
  slideId: string | null,
  ops: readonly PatchOp[],
  meta: ChangeMeta,
): DeckCommit {
  if (produced.patches.length === 0) return unchanged(slides);
  return {
    slides: produced.next,
    change: {
      slideId,
      patches: snapshotPatches(produced.patches),
      inversePatches: snapshotPatches(produced.inversePatches),
      ops: ops.map((op) => patchOpSchema.parse(op)),
      kind: meta.kind,
      before: meta.before,
      after: meta.after,
      pendingText: meta.pendingText ?? null,
    },
  };
}

export function selectionOf(slideId: string | null, elementIds: readonly string[]): DeckSelection {
  return { slideId, elementIds: [...elementIds] };
}

export function slideOf(slides: readonly SlideIr[], slideId: string): SlideIr | undefined {
  return slides.find((slide) => slide.slideId === slideId);
}

export function elementOf(
  slides: readonly SlideIr[],
  slideId: string,
  elementId: string,
): SlideElement | undefined {
  return slideOf(slides, slideId)?.elements.find((element) => element.elementId === elementId);
}

/** The browser and Node both have it; a caller that wants stable ids passes its own source. */
export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A source of ids that never repeats one already taken. Asking a random source twice for the same
 * id does not happen in practice, but a caller's counter can, and a clash would merge two elements.
 */
export function freshIds(taken: Iterable<string>, next: () => string): () => string | null {
  const used = new Set(taken);
  return () => {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const id = next();
      if (id && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    return null;
  };
}

/** Deduplicate while keeping the first occurrence, so the order a caller gave survives. */
export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
