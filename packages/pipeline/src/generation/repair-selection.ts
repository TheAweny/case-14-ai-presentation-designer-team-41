import type { ComposedSlide, RequiredSlideClaim } from '@lct/contracts';
import { retainsClaimDetails } from './claim-details.js';

/** At most three coordinated proposals plus one independent proposal; edits commit atomically. */
export function selectSlideRepair<Slot extends { slotId: string }>(options: {
  previous: ComposedSlide;
  slots: readonly Slot[];
  rewrites: Readonly<Record<string, readonly string[]>>;
  requiredClaims: readonly RequiredSlideClaim[];
  /** Must return undefined for a candidate that exceeds any character/line/geometry constraint. */
  bestFittingAlternative(slot: Slot, alternatives: readonly string[]): string | undefined;
}): ComposedSlide {
  const { previous, slots, rewrites, requiredClaims, bestFittingAlternative: best } = options;
  const before = previous.texts.map((binding) => binding.text).join('\n');
  const bindings = new Set(previous.texts.map((binding) => binding.slotId));
  const owned = slots.filter((slot) => bindings.has(slot.slotId));
  if (!owned.length) return previous;
  const accept = (
    edits: ReadonlyMap<string, string>,
    coordinated = true,
  ): ComposedSlide | undefined => {
    // Every selected slot must have a fitting proposal. Never apply a partial coordinated set.
    if ((coordinated && edits.size !== owned.length) || edits.size === 0) return undefined;
    const texts = previous.texts.map((binding) => ({
      ...binding,
      text: edits.get(binding.slotId) ?? binding.text,
    }));
    if (
      !retainsClaimDetails(before, texts.map((binding) => binding.text).join('\n'), requiredClaims)
    )
      return undefined;
    return { ...previous, texts };
  };
  const proposals: ComposedSlide[] = [];
  for (let index = 0; index < 3; index++) {
    const edits = new Map<string, string>();
    for (const slot of owned) {
      const candidate = rewrites[slot.slotId]?.[index];
      if (candidate === undefined) continue;
      const fitting = best(slot, [candidate]);
      if (fitting !== undefined) edits.set(slot.slotId, fitting);
    }
    const proposal = accept(edits);
    if (proposal) proposals.push(proposal);
  }
  if (proposals.length) {
    // Prefer a coherent proposal closest to the existing per-slot density preferences.
    const score = (proposal: ComposedSlide) =>
      owned.reduce((total, slot) => {
        const preferred = best(
          slot,
          proposals.flatMap((candidate) =>
            candidate.texts
              .filter((binding) => binding.slotId === slot.slotId)
              .map((binding) => binding.text),
          ),
        );
        return (
          total +
          (proposal.texts.find((binding) => binding.slotId === slot.slotId)?.text === preferred
            ? 1
            : 0)
        );
      }, 0);
    return (
      proposals
        .map((proposal, index) => ({ proposal, index, score: score(proposal) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.proposal ?? previous
    );
  }
  const independent = new Map<string, string>();
  for (const slot of owned) {
    const selected = best(slot, rewrites[slot.slotId] ?? []);
    if (selected !== undefined) independent.set(slot.slotId, selected);
  }
  return accept(independent, false) ?? previous;
}
