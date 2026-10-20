import type { Composition, CompositionNote } from '@lct/contracts';

/** An inconsistent or incomplete index is uncertainty, never permission to invent pairs. */
export function compositionSemantics(pattern: Composition, note?: CompositionNote) {
  const ids = new Set(pattern.slots.map((slot) => slot.slotId));
  const entries = note?.slotSemantics ?? [];
  const groups = note?.groups ?? [];
  const used = new Set<string>();
  const valid =
    new Set(entries.map((entry) => entry.slotId)).size === entries.length &&
    new Set(groups.map((group) => group.id)).size === groups.length &&
    entries.every((entry) => ids.has(entry.slotId)) &&
    groups.every(
      (group) =>
        group.slotIds.length > 0 &&
        group.slotIds.every((id) => {
          if (!ids.has(id) || used.has(id)) return false;
          used.add(id);
          return entries.find((entry) => entry.slotId === id)?.groupId === group.id;
        }),
    ) &&
    entries.every(
      (entry) =>
        !entry.groupId ||
        groups.some((group) => group.id === entry.groupId && group.slotIds.includes(entry.slotId)),
    );
  const semantics = new Map(valid ? entries.map((entry) => [entry.slotId, entry]) : []);
  return {
    groups: valid ? groups.map((group, order) => ({ ...group, order })) : [],
    slots: pattern.slots.map((slot) => ({
      slotId: slot.slotId,
      semanticRole: semantics.get(slot.slotId)?.role ?? 'unknown',
      ...(semantics.get(slot.slotId)?.groupId
        ? { groupId: semantics.get(slot.slotId)?.groupId }
        : {}),
    })),
  };
}

/** Ordered groups preserve process order; heading/body pairs always move together. */
export function semanticSlotMap(
  source: Composition,
  target: Composition,
  sourceNote?: CompositionNote,
  targetNote?: CompositionNote,
): Map<string, string> | undefined {
  if (source.patternId === target.patternId)
    return new Map(source.slots.map((slot) => [slot.slotId, slot.slotId]));
  const a = compositionSemantics(source, sourceNote);
  const b = compositionSemantics(target, targetNote);
  if (source.slots.length !== target.slots.length || a.groups.length !== b.groups.length)
    return undefined;
  const mapping = new Map<string, string>();
  const pair = (left: typeof a.slots, right: typeof b.slots) => {
    if (left.length !== right.length) return false;
    const roles = [...new Set(left.map((slot) => slot.semanticRole))];
    for (const role of roles) {
      const x = left.filter((slot) => slot.semanticRole === role);
      const y = right.filter((slot) => slot.semanticRole === role);
      // Two unknowns (or two bodies) in one group have no unambiguous correspondence.
      if (x.length !== y.length || x.length > 1) return false;
      if (x[0] && y[0]) mapping.set(x[0].slotId, y[0].slotId);
    }
    return true;
  };
  if (!a.groups.length) {
    // Legacy indexes: only one field per coarse role can safely move between layouts.
    for (const role of ['title', 'body'] as const) {
      const x = source.slots.filter((slot) => slot.role === role);
      const y = target.slots.filter((slot) => slot.role === role);
      if (x.length !== y.length || x.length > 1) return undefined;
      if (x[0] && y[0]) mapping.set(x[0].slotId, y[0].slotId);
    }
    return mapping;
  }
  for (const [index, group] of a.groups.entries()) {
    const other = b.groups[index];
    if (
      !other ||
      group.kind !== other.kind ||
      !pair(
        a.slots.filter((slot) => slot.groupId === group.id),
        b.slots.filter((slot) => slot.groupId === other.id),
      )
    )
      return undefined;
  }
  if (
    !pair(
      a.slots.filter((slot) => !slot.groupId),
      b.slots.filter((slot) => !slot.groupId),
    )
  )
    return undefined;
  return mapping.size === source.slots.length ? mapping : undefined;
}
