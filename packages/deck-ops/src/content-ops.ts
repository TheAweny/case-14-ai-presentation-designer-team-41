import {
  imageCropSchema,
  type Box,
  type ImageCrop,
  type Paragraph,
  type SlideIr,
} from '@lct/contracts';
import {
  commitProduced,
  elementOf,
  produceSlides,
  selectionOf,
  slideOf,
  unchanged,
  type DeckCommit,
} from './core.js';

/*
 * Words in a shape
 * ----------------
 */

/** Nothing but whitespace: a shape with such text has none, as far as the contract goes. */
function blank(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.every((paragraph) => paragraph.runs.every((run) => run.text.trim() === ''));
}

/**
 * Replace the words inside a shape. Call it once, when the text editor on the shape closes, like
 * `commitSetText`. Blank text takes the key away, so a shape whose words were deleted is a plain
 * shape again rather than one with an empty text body. A line takes no text.
 *
 * The engine has no operation for this, so the entry carries no ops: the exported slide is the
 * source of truth.
 */
export function commitShapeText(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly paragraphs: readonly Paragraph[];
  },
): DeckCommit {
  const element = elementOf(slides, change.slideId, change.elementId);
  if (!element || element.kind !== 'decor' || element.shape === 'line') return unchanged(slides);
  const next = blank(change.paragraphs)
    ? null
    : (structuredClone(change.paragraphs) as Paragraph[]);
  if (next === null && element.paragraphs === undefined) return unchanged(slides);
  if (next !== null && JSON.stringify(element.paragraphs) === JSON.stringify(next)) {
    return unchanged(slides);
  }
  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    if (!target || target.kind !== 'decor') return;
    if (next === null) delete target.paragraphs;
    else target.paragraphs = structuredClone(next);
  });
  const edited = selectionOf(change.slideId, [change.elementId]);
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'text',
    before: edited,
    after: edited,
  });
}

/*
 * Cropping a picture
 * ------------------
 */

/** `a:srcRect` counts in thousandths of a percent: finer than that is not written anyway. */
const CROP_STEP = 100_000;

/** The least share of the picture a crop leaves on each axis: a hundredth of a percent. */
export const MIN_CROP_REST = 0.0001;

function roundShare(value: number): number {
  const rounded = Math.round(value * CROP_STEP) / CROP_STEP;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A crop as the contract and OOXML take it: every side in [0, 1), rounded to what `srcRect` can
 * say, and something left of the picture on both axes. Null when there is no such crop.
 */
export function normalCrop(crop: ImageCrop): ImageCrop | null {
  const sides = [crop.l, crop.t, crop.r, crop.b];
  if (!sides.every((side) => Number.isFinite(side))) return null;
  const next = {
    l: roundShare(Math.max(0, crop.l)),
    t: roundShare(Math.max(0, crop.t)),
    r: roundShare(Math.max(0, crop.r)),
    b: roundShare(Math.max(0, crop.b)),
  };
  if (1 - next.l - next.r < MIN_CROP_REST || 1 - next.t - next.b < MIN_CROP_REST) return null;
  return imageCropSchema.safeParse(next).success ? next : null;
}

/** A crop that cuts nothing is no crop. */
function cutsNothing(crop: ImageCrop): boolean {
  return crop.l === 0 && crop.t === 0 && crop.r === 0 && crop.b === 0;
}

function sameCrop(left: ImageCrop | undefined, right: ImageCrop | null): boolean {
  if (!left || !right) return !left && !right;
  return left.l === right.l && left.t === right.t && left.r === right.r && left.b === right.b;
}

/**
 * Crop a picture, and give it the box the crop frame ended with, as one step of history: in a
 * crop mode the frame and the part of the picture it shows change together. Null, or a crop that
 * cuts nothing, takes the crop away and the picture is placed by `fit` again. A crop that leaves
 * nothing of the picture changes nothing.
 */
export function commitImageCrop(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementId: string;
    readonly crop: ImageCrop | null;
    readonly box?: Box;
  },
): DeckCommit {
  const element = elementOf(slides, change.slideId, change.elementId);
  if (!element || element.kind !== 'image') return unchanged(slides);
  let crop: ImageCrop | null = null;
  if (change.crop) {
    const normal = normalCrop(change.crop);
    if (!normal) return unchanged(slides);
    crop = cutsNothing(normal) ? null : normal;
  }
  const box = change.box
    ? {
        x: Math.round(change.box.x),
        y: Math.round(change.box.y),
        cx: Math.round(change.box.cx),
        cy: Math.round(change.box.cy),
      }
    : null;
  if (box && (box.cx <= 0 || box.cy <= 0)) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const target = elementOf(draft, change.slideId, change.elementId);
    if (!target || target.kind !== 'image') return;
    if (!sameCrop(target.crop, crop)) {
      if (crop) target.crop = { ...crop };
      else delete target.crop;
    }
    if (
      box &&
      (target.box.x !== box.x ||
        target.box.y !== box.y ||
        target.box.cx !== box.cx ||
        target.box.cy !== box.cy)
    ) {
      target.box = box;
    }
  });
  const edited = selectionOf(change.slideId, [change.elementId]);
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'crop',
    before: edited,
    after: edited,
  });
}

/*
 * Speaker notes
 * -------------
 */

/**
 * Replace the speaker notes of a slide. Text with nothing but whitespace takes the key away:
 * a slide with no notes says nothing about them. Line breaks are kept, one notes paragraph each.
 */
export function commitSlideNotes(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly notes: string },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const notes = change.notes.replaceAll('\r\n', '\n');
  const next = notes.trim() === '' ? null : notes;
  if ((slide.notes ?? null) === next) return unchanged(slides);
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, change.slideId);
    if (!target) return;
    if (next === null) delete target.notes;
    else target.notes = next;
  });
  return commitProduced(slides, produced, change.slideId, [], {
    kind: 'notes',
    before: selectionOf(change.slideId, []),
    after: selectionOf(change.slideId, []),
  });
}

const PLAIN_RUN = {
  text: '',
  font: '',
  sizePt: null,
  bold: null,
  italic: null,
  color: '',
} as const;

/**
 * Paragraphs for plain text written by an agent, set as the element set its text: line `n` takes
 * the look of paragraph `n` (the last one for lines past it) and of that paragraph's first run.
 * The agent writes words; the template's typography stays where it was.
 */
export function paragraphsForText(current: readonly Paragraph[], text: string): Paragraph[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line, index) => {
    const model = current[Math.min(index, current.length - 1)];
    const run = model?.runs[0] ?? PLAIN_RUN;
    const paragraph: Paragraph = model
      ? structuredClone(model)
      : { level: 0, runs: [], lineSpacing: null };
    return { ...paragraph, runs: [{ ...structuredClone(run), text: line }] };
  });
}
