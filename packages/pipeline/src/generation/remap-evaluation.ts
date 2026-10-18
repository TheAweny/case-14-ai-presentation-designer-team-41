import {
  compositionPlanSchema,
  generationProfileSchema,
  storedTemplateIndexSchema,
  type GenerationProfile,
} from '@lct/contracts';
import { z } from 'zod';
import {
  remapPlan,
  prepareVariantCatalog,
  writerSlots,
  type DeckVariant,
  type LayoutRemapPolicy,
} from './workflow.js';

const VARIANTS = ['dense', 'balanced', 'airy'] as const satisfies readonly DeckVariant[];
const POLICIES = [
  'density',
  'preserve-block-count',
] as const satisfies readonly LayoutRemapPolicy[];

export const layoutRemapComparisonInputSchema = z.object({
  plan: compositionPlanSchema,
  profile: generationProfileSchema,
  index: storedTemplateIndexSchema.optional(),
  /**
   * Whether the saved plan was made with pictures available. This changes which compositions
   * the generation catalog keeps, so a comparison must use the same answer.
   */
  imagesAvailable: z.boolean().default(false),
});

const slideChangeSchema = z.object({
  index: z.number().int().nonnegative(),
  plannedPatternId: z.string(),
  patternId: z.string(),
  plannedBlocks: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  plannedCapacity: z.number().int().nonnegative(),
  capacity: z.number().int().nonnegative(),
});

const variantComparisonSchema = z.object({
  variant: z.enum(VARIANTS),
  policy: z.enum(POLICIES),
  patternIds: z.array(z.string()),
  distinctPatternIds: z.number().int().nonnegative(),
  changedSlides: z.number().int().nonnegative(),
  blockCountChanges: z.number().int().nonnegative(),
  capacityChanges: z.number().int().nonnegative(),
  changes: z.array(slideChangeSchema),
});

export const layoutRemapComparisonSchema = z.object({
  templateHash: z.string().length(64),
  slideCount: z.number().int().positive(),
  variants: z.array(variantComparisonSchema).length(VARIANTS.length * POLICIES.length),
});

export type LayoutRemapComparisonInput = z.input<typeof layoutRemapComparisonInputSchema>;
export type LayoutRemapComparison = z.infer<typeof layoutRemapComparisonSchema>;

export class LayoutRemapComparisonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutRemapComparisonError';
  }
}

function contentSlots(pattern: GenerationProfile['compositions'][number]) {
  return writerSlots(pattern).filter((slot) => slot.role !== 'title');
}

function requirePattern(
  byId: Map<string, GenerationProfile['compositions'][number]>,
  patternId: string,
  kind: 'planned' | 'mapped',
): GenerationProfile['compositions'][number] {
  const pattern = byId.get(patternId);
  if (!pattern) {
    throw new LayoutRemapComparisonError(
      `Missing ${kind} composition ${patternId} in the prepared catalog.`,
    );
  }
  return pattern;
}

function blocksOf(pattern: GenerationProfile['compositions'][number]): number {
  return contentSlots(pattern).length;
}

function capacityOf(pattern: GenerationProfile['compositions'][number]): number {
  return contentSlots(pattern).reduce((sum, slot) => sum + slot.maxChars, 0);
}

/**
 * Compare the existing density remap with a strict block-count remap on one saved plan.
 * This is a structural count of layout choices. It does not score copy, call a model, or
 * claim that either policy produces a better deck.
 */
export function compareLayoutRemap(input: LayoutRemapComparisonInput): LayoutRemapComparison {
  const parsed = layoutRemapComparisonInputSchema.parse(input);
  if (parsed.index && parsed.index.templateHash !== parsed.profile.templateHash) {
    throw new LayoutRemapComparisonError(
      'Template index hash does not match the generation profile.',
    );
  }
  const seen = new Set<string>();
  const duplicatePatternIds = parsed.profile.compositions.flatMap((pattern) => {
    if (seen.has(pattern.patternId)) return [pattern.patternId];
    seen.add(pattern.patternId);
    return [];
  });
  if (duplicatePatternIds.length) {
    throw new LayoutRemapComparisonError(
      `Generation profile repeats pattern ids: ${[...new Set(duplicatePatternIds)].join(', ')}`,
    );
  }
  const planned = parsed.plan.slides.map((slide) => slide.patternId);
  const rawById = new Map(
    parsed.profile.compositions.map((pattern) => [pattern.patternId, pattern]),
  );
  const missing = planned.filter((id) => !rawById.has(id));
  if (missing.length) {
    throw new LayoutRemapComparisonError(
      `Plan pattern ids are not in this template profile: ${[...new Set(missing)].join(', ')}`,
    );
  }
  const prepared = VARIANTS.map((variant) => ({
    variant,
    ...prepareVariantCatalog(parsed.profile, parsed.index?.notes ?? [], {
      imagesAvailable: parsed.imagesAvailable,
      variant,
    }),
  }));
  const usable = new Set(prepared.flatMap((item) => item.full.map((pattern) => pattern.patternId)));
  const unusable = planned.filter((id) => !usable.has(id));
  if (unusable.length) {
    throw new LayoutRemapComparisonError(
      `Plan uses compositions the generation catalog drops for imagesAvailable=${parsed.imagesAvailable}: ${[...new Set(unusable)].join(', ')}`,
    );
  }
  const variants = VARIANTS.flatMap((variant) => {
    const ready = prepared.find((item) => item.variant === variant);
    if (!ready) throw new LayoutRemapComparisonError(`Missing catalog for ${variant}.`);
    const byId = new Map(ready.compositions.map((pattern) => [pattern.patternId, pattern]));
    return POLICIES.map((policy) => {
      const patternIds = remapPlan(
        planned,
        ready.full,
        ready.catalog,
        variant,
        ready.covers,
        ready.notes,
        policy,
      );
      const changes = patternIds.flatMap((patternId, index) => {
        const plannedPatternId = planned[index] ?? '';
        if (patternId === plannedPatternId) return [];
        const before = requirePattern(byId, plannedPatternId, 'planned');
        const after = requirePattern(byId, patternId, 'mapped');
        return [
          {
            index,
            plannedPatternId,
            patternId,
            plannedBlocks: blocksOf(before),
            blocks: blocksOf(after),
            plannedCapacity: capacityOf(before),
            capacity: capacityOf(after),
          },
        ];
      });
      return {
        variant,
        policy,
        patternIds,
        distinctPatternIds: new Set(patternIds).size,
        changedSlides: changes.length,
        blockCountChanges: changes.filter((change) => change.blocks !== change.plannedBlocks)
          .length,
        capacityChanges: changes.filter((change) => change.capacity !== change.plannedCapacity)
          .length,
        changes,
      };
    });
  });
  return layoutRemapComparisonSchema.parse({
    templateHash: parsed.profile.templateHash,
    slideCount: parsed.plan.slides.length,
    variants,
  });
}
