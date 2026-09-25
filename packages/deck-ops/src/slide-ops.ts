import { colorValueSchema, slideIrSchema, type ColorValue, type SlideIr } from '@lct/contracts';
import {
  commitProduced,
  freshIds,
  produceSlides,
  randomId,
  selectionOf,
  slideOf,
  unchanged,
  type DeckCommit,
} from './core.js';

/** Positions are the array: after a change every slide's `index` is its place again. */
function renumber(draft: SlideIr[]): void {
  for (const [index, slide] of draft.entries()) {
    if (slide.index !== index) slide.index = index;
  }
}

function neighbourOf(slides: readonly SlideIr[], index: number): string | null {
  return slides[index + 1]?.slideId ?? slides[index - 1]?.slideId ?? null;
}

/**
 * Put a slide into the deck at `index`.
 *
 * The slide itself comes from the caller: a new one needs a `patternId` from the template, which
 * is a question about the template profile rather than about the journal. Everything else — the
 * position, the numbering and the check against the contract — happens here.
 */
export function commitInsertSlide(
  slides: readonly SlideIr[],
  change: { readonly index: number; readonly slide: SlideIr },
): DeckCommit {
  const { index } = change;
  if (!Number.isInteger(index) || index < 0 || index > slides.length) return unchanged(slides);
  if (slides.some((slide) => slide.slideId === change.slide.slideId)) return unchanged(slides);
  const parsed = slideIrSchema.safeParse({ ...change.slide, index });
  if (!parsed.success) return unchanged(slides);

  const produced = produceSlides(slides, (draft) => {
    draft.splice(index, 0, structuredClone(parsed.data));
    renumber(draft);
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-insert',
    before: selectionOf(slides[index - 1]?.slideId ?? slides[index]?.slideId ?? null, []),
    after: selectionOf(parsed.data.slideId, []),
  });
}

/**
 * Copy a slide and put the copy right after it. Element ids stay as they are: they identify an
 * element inside its slide, and the copy is a different slide.
 */
export function commitDuplicateSlide(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly newSlideId?: string;
    readonly nextId?: () => string;
  },
): DeckCommit {
  const index = slides.findIndex((slide) => slide.slideId === change.slideId);
  const slide = slides[index];
  if (!slide) return unchanged(slides);
  const taken = slides.map((item) => item.slideId);
  const next = freshIds(taken, change.nextId ?? randomId);
  const slideId =
    change.newSlideId && !taken.includes(change.newSlideId) ? change.newSlideId : next();
  if (slideId === null) return unchanged(slides);

  const copy: SlideIr = { ...structuredClone(slide), slideId, index: index + 1 };
  const produced = produceSlides(slides, (draft) => {
    draft.splice(index + 1, 0, copy);
    renumber(draft);
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-duplicate',
    before: selectionOf(change.slideId, []),
    after: selectionOf(slideId, []),
  });
}

/** Remove a slide. The last one stays: a deck with no slides is not a deck. */
export function commitRemoveSlide(
  slides: readonly SlideIr[],
  change: { readonly slideId: string },
): DeckCommit {
  if (slides.length <= 1) return unchanged(slides);
  const index = slides.findIndex((slide) => slide.slideId === change.slideId);
  if (index < 0) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    draft.splice(index, 1);
    renumber(draft);
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-remove',
    before: selectionOf(change.slideId, []),
    after: selectionOf(neighbourOf(slides, index), []),
  });
}

/*
 * Several slides at once
 * ----------------------
 *
 * A list of slides picked together moves, copies and goes as one step of history. The slides
 * keep their deck order whatever order they were picked in.
 */

/** The slides named, in deck order, without repeats or unknown ids. */
function inDeckOrder(slides: readonly SlideIr[], slideIds: readonly string[]): SlideIr[] {
  const wanted = new Set(slideIds);
  return slides.filter((slide) => wanted.has(slide.slideId));
}

/**
 * Move slides as one block. `index` is where the block starts among the slides that are not
 * moving, from 0 (first) to their count (last); the block keeps its deck order.
 */
export function commitMoveSlides(
  slides: readonly SlideIr[],
  change: { readonly slideIds: readonly string[]; readonly index: number },
): DeckCommit {
  const moving = inDeckOrder(slides, change.slideIds);
  const staying = slides.filter((slide) => !moving.includes(slide));
  const { index } = change;
  if (moving.length === 0 || !Number.isInteger(index) || index < 0 || index > staying.length) {
    return unchanged(slides);
  }
  const order = [...staying.slice(0, index), ...moving, ...staying.slice(index)];
  if (order.every((slide, at) => slide === slides[at])) return unchanged(slides);
  const ids = order.map((slide) => slide.slideId);
  const produced = produceSlides(slides, (draft) => {
    const byId = new Map(draft.map((slide) => [slide.slideId, slide]));
    const next = ids.map((id) => byId.get(id)).filter((slide) => slide !== undefined);
    draft.splice(0, draft.length, ...next);
    renumber(draft);
  });
  const first = moving[0]?.slideId ?? null;
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-order',
    before: selectionOf(first, []),
    after: selectionOf(first, []),
  });
}

/**
 * Copy slides and put the copies, in deck order, right after the last of them — as Google
 * Slides and PowerPoint do. `newSlideIds` names the copies in that order, when the caller wants
 * to select them; an id that is taken or missing gets a fresh one.
 */
export function commitDuplicateSlides(
  slides: readonly SlideIr[],
  change: {
    readonly slideIds: readonly string[];
    readonly newSlideIds?: readonly string[];
    readonly nextId?: () => string;
  },
): DeckCommit {
  const originals = inDeckOrder(slides, change.slideIds);
  const last = originals.at(-1);
  if (!last) return unchanged(slides);
  const at = slides.indexOf(last) + 1;
  const taken = new Set(slides.map((slide) => slide.slideId));
  const named = originals.map((_, position) => {
    const wanted = change.newSlideIds?.[position];
    if (!wanted || taken.has(wanted)) return null;
    taken.add(wanted);
    return wanted;
  });
  const next = freshIds(taken, change.nextId ?? randomId);
  const copies: SlideIr[] = [];
  for (const [position, original] of originals.entries()) {
    const slideId = named[position] ?? next();
    if (slideId === null) return unchanged(slides);
    copies.push({ ...structuredClone(original), slideId });
  }
  const produced = produceSlides(slides, (draft) => {
    draft.splice(at, 0, ...copies);
    renumber(draft);
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-duplicate',
    before: selectionOf(originals[0]?.slideId ?? null, []),
    after: selectionOf(copies[0]?.slideId ?? null, []),
  });
}

/**
 * Remove slides in one step. A deck keeps at least one slide, so asking to remove every slide
 * changes nothing. Undo puts each back at its place; the slide opened after is the one that
 * followed the first removed, or the one before it at the end of the deck.
 */
export function commitRemoveSlides(
  slides: readonly SlideIr[],
  change: { readonly slideIds: readonly string[] },
): DeckCommit {
  const removed = new Set(inDeckOrder(slides, change.slideIds));
  if (removed.size === 0 || removed.size >= slides.length) return unchanged(slides);
  const first = slides.findIndex((slide) => removed.has(slide));
  const after =
    slides.slice(first).find((slide) => !removed.has(slide)) ??
    slides
      .slice(0, first)
      .reverse()
      .find((slide) => !removed.has(slide));
  const ids = new Set([...removed].map((slide) => slide.slideId));
  const produced = produceSlides(slides, (draft) => {
    for (let index = draft.length - 1; index >= 0; index -= 1) {
      if (ids.has(draft[index]?.slideId ?? '')) draft.splice(index, 1);
    }
    renumber(draft);
  });
  return commitProduced(slides, produced, null, [], {
    kind: 'slide-remove',
    before: selectionOf(slides[first]?.slideId ?? null, []),
    after: selectionOf(after?.slideId ?? null, []),
  });
}

/**
 * Fill a slide with a palette role or a hex a user chose. Null puts it back on the template
 * background, which is what a slide that says nothing is drawn with.
 */
export function commitSlideBackground(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly background: ColorValue | null },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const { background } = change;
  if (background !== null && !colorValueSchema.safeParse(background).success) {
    return unchanged(slides);
  }
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    if (background === null) {
      if (target.background !== undefined) delete target.background;
      return;
    }
    if (target.background !== background) target.background = background;
  });
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'slide-background',
    before: selectionOf(change.slideId, []),
    after: selectionOf(change.slideId, []),
  });
}
