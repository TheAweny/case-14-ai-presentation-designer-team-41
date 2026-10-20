import type { CompositionNote } from '@lct/contracts';

/**
 * Variety of the layouts a plan uses. The planner is asked to vary them, once, and a model that
 * found one layout it likes goes on using it: six slides of ten on the same composition read as one
 * slide shown again. Code finishes what the request began: a layout used more often than its
 * share, or on three slides in a row, goes to the least used composition that holds the same
 * points, and where the template has none, the slide keeps its layout and the report says so.
 */

interface Composition {
  readonly patternId: string;
  readonly slots: readonly { readonly maxChars: number }[];
}

export interface PlanSlide {
  readonly patternId: string;
}

export interface VarietyOptions<T extends Composition> {
  /** Uses of one composition the plan may have. */
  readonly limit: number;
  /** Text blocks of a composition as the planner counts them: numbering and mirrors are not. */
  readonly blocks: (pattern: T) => number;
  /**
   * What breaks a tie between layouts used equally often: the one nearest in room to the planned
   * (balanced), the lightest (airy) or the roomiest (dense). Variants that must all spread over
   * the same few layouts then still lay them out in a different order.
   */
  readonly bias?: 'near' | 'light' | 'heavy';
  /** The compositions a slide may move to; the whole catalog when absent. */
  readonly pool?: readonly T[];
  /** Characters the text blocks of a composition hold in all. */
  readonly capacity: (pattern: T) => number;
  /** Measured geometry of a composition, independent of its name: equal means the same layout. */
  readonly structure: (pattern: T) => string;
  /**
   * When set, a slide moves only if this accepts the destination. A refusal leaves the slide
   * where it is and reports it as repeated: a chart stays a chart when no other chart layout
   * can take the repeat.
   */
  readonly allowsMove?: (index: number, to: T) => boolean;
}

export interface VarietyResult<S extends PlanSlide> {
  readonly slides: S[];
  /** Slides moved to another composition. */
  readonly moved: { index: number; from: string; to: string }[];
  /** Slides left on a layout used too often: the template holds no other that carries their points. */
  readonly repeated: { index: number; patternId: string }[];
}

/** Kinds that frame a deck rather than carry its points. */
const FRAMING = new Set(['cover', 'section', 'closing']);

export function diversifyPlan<S extends PlanSlide, T extends Composition>(
  slides: readonly S[],
  catalog: readonly T[],
  notes: ReadonlyMap<string, CompositionNote>,
  options: VarietyOptions<T>,
): VarietyResult<S> {
  const { limit, blocks, capacity, structure } = options;
  const byId = new Map(catalog.map((pattern) => [pattern.patternId, pattern]));
  const kind = (id: string) => notes.get(id)?.kind ?? 'other';
  const special = (id: string) => notes.get(id)?.special === true;
  const framing = (id: string) => FRAMING.has(kind(id));
  // A composition that asks for nothing at all, not even a picture the planner did not order, and
  // holds content rather than a frame.
  const free = (options.pool ?? catalog).filter(
    (pattern) =>
      !notes.get(pattern.patternId)?.skip &&
      !special(pattern.patternId) &&
      !framing(pattern.patternId) &&
      (notes.get(pattern.patternId)?.requiredContent ?? []).length === 0,
  );
  const result = [...slides];
  const moved: VarietyResult<S>['moved'] = [];
  const repeated: VarietyResult<S>['repeated'] = [];
  const used = new Map<string, number>();
  const use = (id: string) => used.set(id, (used.get(id) ?? 0) + 1);

  result.forEach((slide, index) => {
    const id = slide.patternId;
    const planned = byId.get(id);
    const ids = result.map((s) => s.patternId);
    const threeInARow = index >= 2 && ids[index - 1] === id && ids[index - 2] === id;
    const overused = (used.get(id) ?? 0) >= limit;
    // The cover and the framing slides are the planner's, as is a layout made for its content.
    if (index === 0 || !planned || special(id) || framing(id) || !(overused || threeInARow)) {
      use(id);
      return;
    }
    const wanted = blocks(planned);
    const before = index > 0 ? ids[index - 1] : undefined;
    const beforeStructure = before ? byId.get(before) : undefined;
    const choices = free
      .filter((pattern) => pattern.patternId !== id)
      .filter((pattern) => (used.get(pattern.patternId) ?? 0) < limit)
      .filter((pattern) => pattern.patternId !== before)
      .filter((pattern) => blocks(pattern) > 0 && Math.abs(blocks(pattern) - wanted) <= 1)
      .filter((pattern) => options.allowsMove?.(index, pattern) !== false)
      // A layout with more room asks the writer for a point it was not planned: one block at
      // most, and the same count first.
      .sort(
        (a, b) =>
          Math.abs(blocks(a) - wanted) - Math.abs(blocks(b) - wanted) ||
          (used.get(a.patternId) ?? 0) - (used.get(b.patternId) ?? 0) ||
          Number(beforeStructure !== undefined && structure(a) === structure(beforeStructure)) -
            Number(beforeStructure !== undefined && structure(b) === structure(beforeStructure)) ||
          Number(kind(b.patternId) === kind(id)) - Number(kind(a.patternId) === kind(id)) ||
          (options.bias === 'light'
            ? capacity(a) - capacity(b)
            : options.bias === 'heavy'
              ? capacity(b) - capacity(a)
              : Math.abs(capacity(a) - capacity(planned)) -
                Math.abs(capacity(b) - capacity(planned))),
      );
    const choice = choices[0];
    if (!choice) {
      repeated.push({ index, patternId: id });
      use(id);
      return;
    }
    result[index] = { ...slide, patternId: choice.patternId };
    moved.push({ index, from: id, to: choice.patternId });
    use(choice.patternId);
  });
  return { slides: result, moved, repeated };
}
