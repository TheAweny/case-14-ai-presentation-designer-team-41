import { z } from 'zod';
import { deckPlanSchema } from './deck-plan.js';
import { designSystemSchema } from './design-system.js';
import { patternCatalogSchema } from './pattern-catalog.js';
import { layoutVariantNameSchema, slideIrSchema } from './slide-ir.js';

/**
 * LayoutVariantsRequest and LayoutVariantsResponse — one plan laid out three ways.
 *
 * The plan is written once, by the agents on the TypeScript side, and the engine renders it as
 * every requested variant against the same template profile. The response carries the profile
 * too, so the caller can audit and render the variants without asking for the template again.
 */

export const layoutVariantsRequestSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  templatePath: z.string().min(1).describe('Local path of the template the deck follows.'),
  plan: deckPlanSchema,
  variants: z
    .array(layoutVariantNameSchema)
    .min(1)
    .max(3)
    .optional()
    .describe('Variants to build. Absent: all three.'),
});

export const variantLayoutSchema = z.object({
  variant: layoutVariantNameSchema,
  slides: z.array(slideIrSchema).min(1),
});

export const layoutVariantsResponseSchema = z.object({
  schemaVersion: z.literal(1).describe('Incremented by any incompatible change.'),
  designSystem: designSystemSchema,
  patternCatalog: patternCatalogSchema,
  variants: z.array(variantLayoutSchema).min(1).describe('In the order dense, balanced, airy.'),
});

export type LayoutVariantsRequest = z.infer<typeof layoutVariantsRequestSchema>;
export type VariantLayout = z.infer<typeof variantLayoutSchema>;
export type LayoutVariantsResponse = z.infer<typeof layoutVariantsResponseSchema>;
