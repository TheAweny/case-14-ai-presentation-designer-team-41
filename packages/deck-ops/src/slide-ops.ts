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
