import { z } from 'zod';
import { designSystemSchema } from './design-system.js';
import { boxSchema, templateIrSchema } from './template-ir.js';
import { modelRefSchema } from './model-settings.js';

export const compositionSlotSchema = z.object({
  slotId: z.string().min(1),
  role: z.enum(['title', 'body']),
  sample: z.string(),
  maxChars: z.number().int().positive(),
  maxLines: z.number().int().positive(),
  font: z.string(),
  fontSize: z.number().positive(),
  box: boxSchema.optional(),
  textWidthPt: z.number().positive().optional(),
  textHeightPt: z.number().positive().optional(),
  lineSpacing: z.number().positive().optional(),
  spaceBeforePt: z.number().nonnegative().optional(),
  spaceAfterPt: z.number().nonnegative().optional(),
});
export const compositionSchema = z.object({
  patternId: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
  name: z.string(),
  slots: z.array(compositionSlotSchema).min(1),
  imageCount: z.number().int().nonnegative(),
});
export const generationProfileSchema = z.object({
  schemaVersion: z.literal(1),
  templateHash: z.string().length(64),
  designSystem: designSystemSchema,
  compositions: z.array(compositionSchema).min(1),
});
export const composedSlideSchema = z.object({
  patternId: z.string().min(1),
  texts: z.array(z.object({ slotId: z.string().min(1), text: z.string() })).min(1),
  speakerNotes: z.string(),
});
export const compositionExportRequestSchema = z.object({
  schemaVersion: z.literal(1),
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  slides: z.array(composedSlideSchema).min(1).max(60),
});
export const compositionExportResponseSchema = z.object({
  schemaVersion: z.literal(1),
  outputPath: z.string().min(1),
  templateIr: templateIrSchema,
  previews: z.array(z.string()),
  pdfPath: z.string(),
  warnings: z.array(z.string()),
  /**
   * Template families the render server could not resolve. Empty when every selected family is
   * installed. The pptx keeps these names; previews may draw substitutes.
   */
  missingFonts: z.array(z.string()),
});
export const generationRequestSchema = z.object({
  templateId: z.string().uuid(),
  brief: z.string().trim().min(10).max(60000),
  slideCount: z.number().int().min(10).max(15).nullable().default(null),
  projectId: z.string().nullable().default(null),
  contentIds: z.array(z.string().uuid()).max(10).default([]),
  seed: z.number().int().default(42),
  /**
   * The model to write the deck with, as the interface picked it. Null: the model of the writer
   * role, or the one the server is configured with. Never a key: the API resolves the connection.
   */
  model: modelRefSchema.nullable().default(null),
});
export type GenerationProfile = z.infer<typeof generationProfileSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type ComposedSlide = z.infer<typeof composedSlideSchema>;
export type CompositionExportRequest = z.infer<typeof compositionExportRequestSchema>;
export type CompositionExportResponse = z.infer<typeof compositionExportResponseSchema>;
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export const compositionFindingSchema = z.object({
  slideIndex: z.number().int().nonnegative(),
  slotId: z.string(),
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  lines: z.number().int().nonnegative(),
  maxLines: z.number().int().positive(),
  maxChars: z.number().int().positive(),
  message: z.string(),
});
export const compositionCheckResponseSchema = z.object({
  schemaVersion: z.literal(1),
  findings: z.array(compositionFindingSchema),
});
export type CompositionFinding = z.infer<typeof compositionFindingSchema>;
export type CompositionCheckResponse = z.infer<typeof compositionCheckResponseSchema>;

export const compositionPlanSchema = z.object({
  title: z.string().min(1).max(100),
  slides: z
    .array(
      z.object({
        patternId: z.string(),
        purpose: z.string().min(1).max(600),
        imageQuery: z.string().default(''),
      }),
    )
    .min(10)
    .max(60),
});

export const compositionCritiqueSchema = z.object({
  issues: z
    .array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        slotId: z.string(),
        category: z.enum(['factual-error', 'incomplete-text', 'instruction-leftover', 'style']),
        message: z.string(),
      }),
    )
    .max(12),
});

export const templateSlotCopySchema = z.object({
  patternId: z.string(),
  textsBySlot: z.record(z.string(), z.string()),
  speakerNotes: z.string(),
});
export const slotRewriteChoicesSchema = z.object({
  rewrites: z.record(z.string(), z.array(z.string()).length(3)),
});
export type CompositionPlan = z.infer<typeof compositionPlanSchema>;
export type CompositionCritique = z.infer<typeof compositionCritiqueSchema>;
export type TemplateSlotCopy = z.infer<typeof templateSlotCopySchema>;
export type SlotRewriteChoices = z.infer<typeof slotRewriteChoicesSchema>;
