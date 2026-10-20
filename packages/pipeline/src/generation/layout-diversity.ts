import type { GenerationProfile } from '@lct/contracts';
import { compositionStructure, writerSlots } from './workflow.js';

/** Whether this template can carry three compositions that are not the same design. */
export interface LayoutDiversity {
  independent: boolean;
  distinctStructures: number;
  distinctPlacements: number;
  limitation: string | null;
}

/** Column and band of each body slot. A nudge of type size is not a different placement. */
function placement(pattern: GenerationProfile['compositions'][number]): string {
  return writerSlots(pattern)
    .filter((slot) => slot.role !== 'title')
    .map((slot) => {
      const box = slot.box;
      if (!box) return 'unplaced';
      const column = Math.round(box.x / Math.max(1, box.cx));
      const band = Math.round(box.y / Math.max(1, box.cy));
      return `${column}:${band}`;
    })
    .join('|');
}

/**
 * Count distinct compositions before any model call. Fewer than three structures means the three
 * variants cannot be three designs; the copy may still differ, and no fact is dropped to fake it.
 */
export function assessLayoutDiversity(profile: GenerationProfile): LayoutDiversity {
  const structures = new Set(profile.compositions.map((pattern) => compositionStructure(pattern)));
  const placements = new Set(profile.compositions.map((pattern) => placement(pattern)));
  const independent = structures.size >= 3;
  const limitation = independent
    ? null
    : structures.size <= 1
      ? 'Шаблон задаёт одну композицию. Три варианта не будут самостоятельными дизайнами: различается текст, вёрстка остаётся общей.'
      : `Шаблон задаёт ${structures.size} различные композиции. Трёх самостоятельных дизайнов из него не получается.`;
  return {
    independent,
    distinctStructures: structures.size,
    distinctPlacements: placements.size,
    limitation,
  };
}

/**
 * Three variant layouts are a success only when their composition sequences differ in structure.
 * The same sequence three times is not three designs, even when the copy is rewritten.
 */
export function acceptVariantLayouts(
  variants: readonly { patternIds: readonly string[] }[],
  profile: GenerationProfile,
): { accepted: boolean; distinctSequences: number } {
  const byId = new Map(profile.compositions.map((pattern) => [pattern.patternId, pattern]));
  const sequences = variants.map((variant) =>
    variant.patternIds
      .map((id) => {
        const pattern = byId.get(id);
        return pattern ? `${compositionStructure(pattern)}#${placement(pattern)}` : id;
      })
      .join('>'),
  );
  const distinctSequences = new Set(sequences).size;
  return {
    accepted: variants.length >= 3 && distinctSequences >= 3,
    distinctSequences,
  };
}
