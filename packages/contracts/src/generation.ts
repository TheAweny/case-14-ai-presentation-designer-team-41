import { z } from 'zod';
import { designSystemSchema } from './design-system.js';
import { boxSchema, templateIrSchema } from './template-ir.js';
import { modelRefSchema } from './model-settings.js';
import { reasoningEffortSchema } from './reasoning.js';

export const compositionSlotSchema = z.object({
  slotId: z.string().min(1),
  role: z.enum(['title', 'body']),
  sample: z.string(),
  /**
   * The sample is the layout's prompt for an empty placeholder ("Образец текста"), not copy the
   * template set in the box: it names what the box expects but says nothing about its length.
   */
  prompt: z.boolean().optional(),
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
/**
 * A place of a composition a picture fills: a picture placeholder, or a large empty card the
 * template left for one (`panel`). The template's own photos and brand art are design, not slots.
 */
export const imageSlotSchema = z.object({
  slotId: z.string().min(1),
  /**
   * `placeholder` — a picture placeholder, `panel` — a large empty card, `photo` — a large sample
   * photo of the template slide, which shows what the slide is about only in the template.
   */
  kind: z.enum(['placeholder', 'panel', 'photo']),
  box: boxSchema,
});
export const compositionSchema = z.object({
  patternId: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
  name: z.string(),
  slots: z.array(compositionSlotSchema).min(1),
  imageCount: z.number().int().nonnegative(),
  /** Places for a picture. Absent in profiles read before pictures were generated. */
  imageSlots: z.array(imageSlotSchema).optional(),
  /** All picture candidates, including small ones; only the indexer assigns QR semantics. */
  qrCandidateSlots: z.array(imageSlotSchema).optional(),
});
export const generationProfileSchema = z.object({
  schemaVersion: z.literal(1),
  templateHash: z.string().length(64),
  designSystem: designSystemSchema,
  compositions: z.array(compositionSchema).min(1),
});
/**
 * A native table or chart drawn in place of one text slot of a composition. The slot's box is
 * kept and its text shape replaced, so the visual sits where the template put content. Figures
 * come from the brief only; the pipeline drops a visual whose numbers it cannot find there.
 */
export const slotTableSchema = z.object({
  kind: z.literal('table'),
  slotId: z.string().min(1),
  headers: z.array(z.string()).min(2).max(5),
  rows: z.array(z.array(z.string())).min(1).max(7),
});

export const slotChartSchema = z.object({
  kind: z.literal('chart'),
  slotId: z.string().min(1),
  chartType: z.enum(['bar', 'column', 'line', 'pie']),
  categories: z.array(z.string().min(1)).min(2).max(8),
  series: z
    .array(z.object({ name: z.string().min(1), values: z.array(z.number()).min(2).max(8) }))
    .min(1)
    .max(5),
  xTitle: z.string(),
  yTitle: z.string().describe('The value axis title with its unit.'),
});

export const slotVisualSchema = z.discriminatedUnion('kind', [slotTableSchema, slotChartSchema]);

export const composedSlideSchema = z.object({
  patternId: z.string().min(1),
  texts: z.array(z.object({ slotId: z.string().min(1), text: z.string() })).min(1),
  speakerNotes: z.string(),
  visual: slotVisualSchema
    .nullable()
    .optional()
    .describe('A table or chart replacing one text slot. Absent or null: text only.'),
  images: z
    .array(
      z.object({
        slotId: z.string().min(1).describe('An imageSlots id of the composition.'),
        path: z
          .string()
          .regex(/^media\/[\w.-]+\.(?:png|jpe?g)$/)
          .describe('The picture file, relative to the run directory: media/<name>.png.'),
        fit: z
          .enum(['cover', 'contain'])
          .describe('cover crops the picture to fill the box; contain fits it whole inside.'),
        purpose: z.enum(['qr', 'illustration']).optional(),
      }),
    )
    .optional()
    .describe(
      'Generated pictures for image slots. An image slot without one is removed on export, ' +
        'so no empty frame or blank card is left.',
    ),
});
export const compositionExportRequestSchema = z.object({
  schemaVersion: z.literal(1),
  templatePath: z.string().min(1),
  outputPath: z.string().min(1),
  slides: z.array(composedSlideSchema).min(1).max(60),
  /** The day the deck is dated by, YYYY-MM-DD; the audit calls older years past. Absent: today. */
  today: z.iso.date().optional(),
  /** Years the brief names: a past year the brief speaks of is not a leftover. */
  briefYears: z.array(z.number().int()).optional(),
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
/** What a slide does in a deck: the template indexer sorts compositions by it, a plan uses it too. */
export const slideKindSchema = z.enum([
  'cover',
  'section',
  'statement',
  'list',
  'cards',
  'process',
  'comparison',
  'problem-solution',
  'team',
  'closing',
  'reference',
  'other',
]);
export type SlideKind = z.infer<typeof slideKindSchema>;

/** Automatic and approved decks may contain 5 to 60 slides; manual sizing is 5 to 15. */
export const OUTLINE_SLIDES = { min: 5, max: 60 } as const;

export const outlineSlideSchema = z.object({
  /** The claim of the slide, as its title would say it. */
  title: z.string().trim().min(1).max(160),
  /** What the slide says under the title: facts, numbers, items. */
  points: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  kind: slideKindSchema.default('other'),
});
export type OutlineSlide = z.infer<typeof outlineSlideSchema>;

/**
 * The story of a deck before any template: what each slide says, in order. The chat shows it for
 * approval; the planner then lays it out on the compositions of the chosen template, keeping the
 * order and the number of slides, so the same outline can be built in any template.
 */
export const deckOutlineSchema = z.object({
  title: z.string().trim().min(1).max(100),
  audience: z.string().trim().max(300).default(''),
  goal: z.string().trim().max(300).default(''),
  slides: z.array(outlineSlideSchema).min(OUTLINE_SLIDES.min).max(OUTLINE_SLIDES.max),
});
export type DeckOutline = z.infer<typeof deckOutlineSchema>;

export const generationRequestSchema = z.object({
  /** Reuse this id on transport retries; a new id explicitly regenerates the deck. */
  requestId: z.string().uuid().optional(),
  budget: z
    .object({
      maxHttpRequests: z.number().int().min(1).max(240),
      maxReservedTokens: z.number().int().min(1).max(2_000_000),
    })
    .optional(),
  /** A model draft guides the story but cannot independently substantiate its facts. */
  outlineSource: z.enum(['user', 'model']).optional(),
  templateId: z.string().uuid(),
  brief: z.string().trim().min(10).max(60000),
  slideCount: z.number().int().min(5).max(15).nullable().default(null),
  /**
   * The approved story of the deck. With it the planner keeps these slides, in this order, and
   * only chooses a composition for each; `slideCount` is then the length of the outline.
   */
  outline: deckOutlineSchema.nullable().default(null),
  projectId: z.string().nullable().default(null),
  contentIds: z.array(z.string().uuid()).max(10).default([]),
  seed: z.number().int().default(42),
  /**
   * The model to write the deck with, as the interface picked it. Null: the model of the writer
   * role, or the one the server is configured with. Never a key: the API resolves the connection.
   */
  model: modelRefSchema.nullable().default(null),
  /**
   * Whether a model that can answer both ways thinks while it writes; null — it does not. Models
   * that always or never think ignore it.
   */
  thinking: z.boolean().nullable().default(null),
  /** Depth for models that take `reasoning_effort`; null — the model's own or a medium one. */
  reasoningEffort: reasoningEffortSchema.nullable().default(null),
});
export type GenerationProfile = z.infer<typeof generationProfileSchema>;
export type Composition = z.infer<typeof compositionSchema>;
export type ComposedSlide = z.infer<typeof composedSlideSchema>;
export type SlotVisual = z.infer<typeof slotVisualSchema>;
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
  /**
   * Who the deck is for and what they should do after it, as the planner read them from the
   * brief. Every writer call receives them, so each slide speaks to the same listener.
   */
  audience: z.string().max(300).default(''),
  goal: z.string().max(300).default(''),
  title: z.string().min(1).max(100),
  slides: z
    .array(
      z.object({
        patternId: z.string(),
        purpose: z.string().min(1).max(600),
        imageQuery: z.string().default(''),
        qrRequests: z
          .array(z.object({ slotId: z.string().min(1), url: z.string().min(1) }))
          .max(10)
          .optional(),
        /** Exact excerpts proving that a composition's required facts are in the source. */
        sourceEvidence: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(OUTLINE_SLIDES.min)
    .max(60),
});

export const compositionCritiqueSchema = z.object({
  coverage: z
    .array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        claimIndex: z.number().int().nonnegative(),
        quote: z.string().min(1),
      }),
    )
    .default([]),
  issues: z
    .array(
      z.object({
        slideIndex: z.number().int().nonnegative(),
        slotId: z.string(),
        category: z.enum([
          'factual-error',
          'incomplete-text',
          'instruction-leftover',
          'label-title',
          'duplicate-text',
          'meta-narration',
          'style',
        ]),
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
/**
 * What one template composition is for, as the template indexer read it once when the template
 * was prepared. The planner sees this instead of guessing from raw samples. Model-only: the
 * engine neither produces nor reads it.
 */
export const compositionNoteSchema = z.object({
  patternId: z.string().min(1),
  kind: slideKindSchema,
  /** Parallel content items the slide shows: cards, steps, columns, list rows. */
  items: z.number().int().min(0).max(12),
  useFor: z.string().max(200),
  /** A short name for people: what sets this variant apart within its kind. */
  title: z.string().max(80).default(''),
  /** A page about the template itself (instructions, fonts, icons, links): never a deck slide. */
  skip: z.boolean(),
  /**
   * Fits only one kind of content — code, formulas, references, a QR code, a device screen, a
   * partner's logo — and is used only when the brief has it.
   */
  special: z.boolean().default(false),
  /** Existing picture ids with explicit QR meaning in the template's text cues. */
  qrSlotIds: z.array(z.string().min(1)).max(10).optional(),
  /** Source material that must exist before this composition can be used. */
  requiredContent: z
    .array(
      z.enum([
        'person-name',
        'contact',
        'date',
        'image',
        'quantitative-data',
        'brand-asset',
        'screenshot',
      ]),
    )
    .default([]),
  /**
   * Semantic role of a text slot, named by the indexer from the slot id it was given.
   * Absent on indexes written before this field. Never inferred from font size.
   */
  slotSemantics: z
    .array(
      z.object({
        slotId: z.string().min(1),
        role: z.enum(['slide-title', 'card-heading', 'body', 'caption', 'unknown']),
        groupId: z.string().min(1).max(80).optional(),
      }),
    )
    .max(200)
    .optional(),
  /** Parallel groups of those slots: one card, one step, or one column. */
  groups: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        kind: z.enum(['card', 'step', 'column']),
        slotIds: z.array(z.string().min(1)).max(40),
      }),
    )
    .max(40)
    .optional(),
});
export const templateIndexSchema = z.object({ notes: z.array(compositionNoteSchema) });
export const storedTemplateIndexSchema = templateIndexSchema.extend({
  profileHash: z.string().length(64).optional(),
  templateHash: z.string().length(64),
  /** Indexer version and instruction hash: a new prompt re-indexes the template. */
  revision: z.string().min(1),
});
export type CompositionNote = z.infer<typeof compositionNoteSchema>;
export type TemplateIndex = z.infer<typeof templateIndexSchema>;
export type StoredTemplateIndex = z.infer<typeof storedTemplateIndexSchema>;
export type CompositionPlan = z.infer<typeof compositionPlanSchema>;
export type CompositionCritique = z.infer<typeof compositionCritiqueSchema>;
export type TemplateSlotCopy = z.infer<typeof templateSlotCopySchema>;
/** What the illustrator agent answers: one prompt for a text-to-image model, in English. */
export const illustrationPromptSchema = z.object({
  prompt: z.string().min(20).max(1200),
});
export type IllustrationPrompt = z.infer<typeof illustrationPromptSchema>;
export type ImageSlot = z.infer<typeof imageSlotSchema>;
export type SlotRewriteChoices = z.infer<typeof slotRewriteChoicesSchema>;
