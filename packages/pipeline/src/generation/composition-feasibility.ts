import type { Composition, RequiredSlideClaim } from '@lct/contracts';

type Slot = Composition['slots'][number];
const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const room = (slot: Slot) => Math.min(slot.maxChars, slot.capacity?.safeChars ?? slot.maxChars);

/** Sufficient room for unchanged facts; failure does not prove that a paraphrase is impossible. */
export function compositionContentBudget(
  slots: readonly Slot[],
  title: string,
  claims: readonly RequiredSlideClaim[],
) {
  const heading = normalized(title);
  const remaining = [...new Set(claims.map((claim) => normalized(claim.text)))].filter(
    (text) => text && text !== heading,
  );
  const titleCapacity = Math.max(0, ...slots.filter((slot) => slot.role === 'title').map(room));
  const bodyCapacity = slots
    .filter((slot) => slot.role !== 'title')
    .reduce((sum, slot) => sum + room(slot), 0);
  const claimBodyRequired = remaining.join('\n').length;
  // A short heading may retain the identifying phrase while its remaining details
  // move into body slots. Keep the full original information budget on the slide.
  const titleRequired = Math.min(heading.length, 18);
  const bodyRequired = claimBodyRequired + Math.max(0, heading.length - titleCapacity);
  return {
    titleCapacity,
    bodyCapacity,
    titleRequired,
    bodyRequired,
    sufficient: titleCapacity >= titleRequired && bodyCapacity >= bodyRequired,
  };
}

/**
 * Pre-writing selection only: no text or binding is moved across semantic groups.
 * The caller owns compatibility (kind, visuals, ordered groups) and writable slots
 * (excluding dates, numbering, contacts and other fields unavailable to the writer).
 * No sufficient compatible layout means undefined, never silent fact deletion.
 */
export function ampleComposition<T extends Composition>({
  selected,
  candidates,
  title,
  claims,
  writableSlots,
  compatible,
  variant,
}: {
  selected: T;
  candidates: readonly T[];
  title: string;
  claims: readonly RequiredSlideClaim[];
  writableSlots: (composition: T) => readonly Slot[];
  compatible: (composition: T) => boolean;
  variant?: 'dense' | 'balanced' | 'airy';
}): T | undefined {
  const budget = (composition: T) =>
    compositionContentBudget(writableSlots(composition), title, claims);
  if (compatible(selected) && budget(selected).sufficient) return selected;
  const ample = candidates
    .filter((candidate) => compatible(candidate) && budget(candidate).sufficient)
    .map((candidate) => ({ candidate, budget: budget(candidate) }))
    .sort(
      (a, b) =>
        a.budget.titleCapacity +
          a.budget.bodyCapacity -
          b.budget.titleCapacity -
          b.budget.bodyCapacity || a.candidate.sourceIndex - b.candidate.sourceIndex,
    );
  if (!ample.length) return undefined;
  // Avoid a distant capacity outlier when the template offers a coherent adequate set.
  const smallest = ample[0];
  if (!smallest) return undefined;
  const baseline = smallest.budget.titleCapacity + smallest.budget.bodyCapacity;
  const nearby = ample.filter(
    (entry) => entry.budget.titleCapacity + entry.budget.bodyCapacity <= baseline * 2,
  );
  const index =
    variant === 'dense'
      ? nearby.length - 1
      : variant === 'balanced'
        ? Math.floor((nearby.length - 1) / 2)
        : 0;
  return nearby[index]?.candidate;
}
