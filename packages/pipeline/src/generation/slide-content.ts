/**
 * One slide's facts, placed onto each layout variant.
 *
 * Variants differ by which slots they offer and how many characters each slot holds.
 * The sentences stay the ones this object already carries: placement never rewrites,
 * clips, or invents a line for a card the content did not fill.
 */

/** A table or chart for the slide. No slot id, coordinates, colors, or fonts. */
export type SlideContentVisual =
  | {
      kind: 'table';
      headers: readonly string[];
      rows: readonly (readonly string[])[];
    }
  | {
      kind: 'chart';
      chartType: 'bar' | 'column' | 'line' | 'pie';
      categories: readonly string[];
      series: readonly { name: string; values: readonly number[] }[];
      xTitle: string;
      yTitle: string;
    };

export interface SlideContentBlock {
  blockId: string;
  text: string;
  /**
   * Claims this sentence rests on. Absent when the block names none.
   * Placement copies the list as given and never adds a claim.
   */
  claimIds?: readonly string[];
}

export interface SlideContent {
  title: string;
  blocks: readonly SlideContentBlock[];
  /**
   * A table or chart still has no slot of its own here. Until placement can reserve one,
   * a set visual cannot fit: success would otherwise claim a title-only composition holds it.
   */
  visual?: SlideContentVisual | null;
}

/** A slot the writer would see: identity, role, and the character ceiling. */
export interface PlacementSlot {
  slotId: string;
  /** `title` receives the slide title. Every other role is a content slot. */
  role: string;
  fitChars: number;
}

/**
 * One variant's composition, slots already in reading order.
 * `patternId` is the composition's own id; placement does not branch on it.
 */
export interface PlacementComposition {
  patternId: string;
  slots: readonly PlacementSlot[];
}

/** A content block bound to the slot that received its text. */
export interface PlacedBlock {
  blockId: string;
  slotId: string;
  text: string;
  /** Present only when the source block carried the field, including an empty list. */
  claimIds?: string[];
}

export type SlidePlacement =
  | {
      ok: true;
      textsBySlot: Record<string, string>;
      blocks: PlacedBlock[];
      visual: SlideContentVisual | null;
    }
  | {
      ok: false;
      reason: 'cannotFit';
      blockId: string;
    };

/** Reported when the title itself has nowhere to go or is longer than the title slot. */
const TITLE_BLOCK_ID = 'title';
/** Reported when the slide carries a table or chart this placer cannot seat. */
const VISUAL_BLOCK_ID = 'visual';

/**
 * Places one slide onto each variant's composition.
 * A variant that cannot hold the title or every block fails whole; the others still place.
 */
export function placeSlideContent<Variant extends string>(
  content: SlideContent,
  compositionsByVariant: Readonly<Record<Variant, PlacementComposition>>,
): Record<Variant, SlidePlacement> {
  const placed = {} as Record<Variant, SlidePlacement>;
  for (const [variant, composition] of Object.entries(compositionsByVariant) as [
    Variant,
    PlacementComposition,
  ][]) {
    placed[variant] = placeOnComposition(content, composition);
  }
  return placed;
}

function placeOnComposition(
  content: SlideContent,
  composition: PlacementComposition,
): SlidePlacement {
  if (content.visual) return cannotFit(VISUAL_BLOCK_ID);

  const titleSlots = composition.slots.filter((slot) => slot.role === 'title');
  const titleSlot = titleSlots[0];
  if (!titleSlot) {
    if (content.title.length > 0) return cannotFit(TITLE_BLOCK_ID);
  } else if (content.title.length > titleSlot.fitChars) {
    return cannotFit(TITLE_BLOCK_ID);
  }

  const contentSlots = composition.slots.filter((slot) => slot.role !== 'title');
  const bound: { block: SlideContentBlock; slot: PlacementSlot }[] = [];
  for (const [index, block] of content.blocks.entries()) {
    const slot = contentSlots[index];
    // Longer than the slot: refuse the variant. The sentence stays whole.
    if (!slot || block.text.length > slot.fitChars) return cannotFit(block.blockId);
    bound.push({ block, slot });
  }

  const textsBySlot: Record<string, string> = {};
  for (const slot of composition.slots) textsBySlot[slot.slotId] = '';
  if (titleSlot) textsBySlot[titleSlot.slotId] = content.title;

  const blocks = bound.map(({ block, slot }) => {
    textsBySlot[slot.slotId] = block.text;
    return placedBlock(block, slot);
  });
  return { ok: true, textsBySlot, blocks, visual: content.visual ?? null };
}

function placedBlock(block: SlideContentBlock, slot: PlacementSlot): PlacedBlock {
  const placed: PlacedBlock = {
    blockId: block.blockId,
    slotId: slot.slotId,
    text: block.text,
  };
  if (block.claimIds !== undefined) placed.claimIds = [...block.claimIds];
  return placed;
}

function cannotFit(blockId: string): SlidePlacement {
  return { ok: false, reason: 'cannotFit', blockId };
}
