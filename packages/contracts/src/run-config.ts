import { z } from 'zod';

/** Layout variant produced for a single deck plan. */
export const layoutVariantSchema = z.enum(['dense', 'balanced', 'airy']);

/** Model reference: an id from configs/models.yaml plus the role it plays in a run. */
export const modelBindingSchema = z.object({
  role: z
    .enum(['planner', 'writer', 'critic', 'vision', 'image'])
    .describe('Role in the pipeline.'),
  modelId: z.string().min(1).describe('Identifier from configs/models.yaml.'),
});

/** Schema of configs/run.example.yaml — the reproducible description of one run. */
export const runConfigSchema = z.object({
  templatePath: z.string().min(1).describe('Path to the .pptx used as the style source.'),
  contentPath: z.string().min(1).describe('Path to the content pack for the deck.'),
  slideCount: z.number().int().min(10).max(15).describe('Number of slides to produce.'),
  layoutVariants: z
    .array(layoutVariantSchema)
    .min(1)
    .describe('Layout variants built from the single deck plan.'),
  auditProfile: z.string().min(1).describe('Name of the audit profile from configs/audit.yaml.'),
  models: z.array(modelBindingSchema).min(1).describe('Models bound to pipeline roles.'),
  seed: z.number().int().nonnegative().describe('Seed that makes a run reproducible.'),
  outputDir: z.string().min(1).describe('Directory that receives run artifacts.'),
});

export type RunConfig = z.infer<typeof runConfigSchema>;
export type LayoutVariant = z.infer<typeof layoutVariantSchema>;
export type ModelBinding = z.infer<typeof modelBindingSchema>;
