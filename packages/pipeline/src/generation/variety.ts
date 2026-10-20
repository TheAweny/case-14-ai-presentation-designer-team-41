import type { CompositionNote } from '@lct/contracts';

/**
 * Variety of the layouts a plan uses. The planner is asked to vary them, once, and a model that
 * found one layout it likes goes on using it: six slides of ten on the same composition read as one
 * slide shown again. Code finishes what the request began: a layout already used goes to one the
 * deck has not shown that holds the same points; one used more often than its share, on two
 * slides in a row, or a single page of the template (a cover, a divider, a closing, a layout made
 * for one kind of content) shown twice must move, and where the template has nothing else, the
 * slide keeps its layout and the report says so.
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
  /** Whether a slide planned on `from` keeps what it needs on `to`: a chart, a picture. */
  readonly compatible?: (from: T, to: T) => boolean;
}

export interface VarietyResult<S extends PlanSlide> {
  readonly slides: S[];
  /** Slides moved to another composition. */
  readonly moved: { index: number; from: string; to: string }[];
  /** Slides left on a layout used too often: the template holds no other that carries their points. */
  readonly repeated: { index: number; patternId: string }[];
  /** Slides moved off a layout repeated next to itself onto one that drops their chart. */
  readonly forced: number[];
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
  const forced: number[] = [];
  const used = new Map<string, number>();
  const use = (id: string) => used.set(id, (used.get(id) ?? 0) + 1);

  result.forEach((slide, index) => {
    const id = slide.patternId;
    const planned = byId.get(id);
    const before = index > 0 ? result[index - 1]?.patternId : undefined;
    const beforePattern = before ? byId.get(before) : undefined;
    const count = used.get(id) ?? 0;
    // The same layout on two slides running reads as one slide shown twice, and so does another
    // id with the very same geometry.
    const adjacent =
      before !== undefined &&
      (before === id ||
        (planned !== undefined &&
          beforePattern !== undefined &&
          structure(planned) === structure(beforePattern)));
    // A cover, a divider, a closing or a layout made for one kind of content is the template's
    // single page: shown twice, it stops reading as that page.
    const single = special(id) || framing(id);
    const overused = count >= limit;
    if (index === 0 || !planned || (count === 0 && !adjacent)) {
      use(id);
      return;
    }
    const wanted = blocks(planned);
    const fits = free
      .filter((pattern) => pattern.patternId !== id)
      .filter((pattern) => pattern.patternId !== before)
      .filter((pattern) => !beforePattern || structure(pattern) !== structure(beforePattern))
      .filter((pattern) => (used.get(pattern.patternId) ?? 0) < limit)
      .filter((pattern) => options.compatible?.(planned, pattern) ?? true)
      .filter((pattern) => blocks(pattern) > 0 && Math.abs(blocks(pattern) - wanted) <= 1);
    // A layout used once already, within its share and not next to itself, moves only to one the
    // deck has not shown yet: every slide on a layout of its own wherever the template allows.
    const mustMove = adjacent || single || overused;
    const choices = (mustMove ? fits : fits.filter((p) => !used.has(p.patternId)))
      // A layout with more room asks the writer for a point it was not planned: one block at
      // most, and the same count first.
      .sort(
        (a, b) =>
          Math.abs(blocks(a) - wanted) - Math.abs(blocks(b) - wanted) ||
          (used.get(a.patternId) ?? 0) - (used.get(b.patternId) ?? 0) ||
          Number(kind(b.patternId) === kind(id)) - Number(kind(a.patternId) === kind(id)) ||
          (options.bias === 'light'
            ? capacity(a) - capacity(b)
            : options.bias === 'heavy'
              ? capacity(b) - capacity(a)
              : Math.abs(capacity(a) - capacity(planned)) -
                Math.abs(capacity(b) - capacity(planned))),
      );
    // Two slides running on one layout is never acceptable: with no layout that keeps the
    // slide's chart, it moves to any free layout with room for its points, and its takeaway text
    // carries the point the chart made.
    const forcedChoice =
      !choices[0] && adjacent
        ? free
            .filter((pattern) => pattern.patternId !== id && pattern.patternId !== before)
            .filter((pattern) => !beforePattern || structure(pattern) !== structure(beforePattern))
            .filter((pattern) => blocks(pattern) > 0)
            .sort(
              (a, b) =>
                (used.get(a.patternId) ?? 0) - (used.get(b.patternId) ?? 0) ||
                Math.abs(blocks(a) - wanted) - Math.abs(blocks(b) - wanted),
            )[0]
        : undefined;
    const choice = choices[0] ?? forcedChoice;
    if (forcedChoice && choice === forcedChoice) forced.push(index);
    if (!choice) {
      if (mustMove) repeated.push({ index, patternId: id });
      use(id);
      return;
    }
    result[index] = { ...slide, patternId: choice.patternId };
    moved.push({ index, from: id, to: choice.patternId });
    use(choice.patternId);
  });
  return { slides: result, moved, repeated, forced };
}
