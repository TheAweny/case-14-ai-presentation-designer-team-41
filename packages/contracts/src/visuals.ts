import { z } from 'zod';
import { designSystemSchema } from './design-system.js';
import { chartTypeSchema, layoutVariantNameSchema, slideElementSchema } from './slide-ir.js';
import { boxSchema } from './template-ir.js';

/**
 * VisualBuild — structured figures the deterministic visuals layer can place.
 *
 * The semantic planner (not this layer) decides which numbers exist and whether a source is
 * grounded. This contract only carries that decision and the template profile, and the engine
 * returns SlideIR the editor and the native export already draw. It never invents a number,
 * never promotes `unverified` to `grounded`, and never calls a model.
 */

export const evidenceStatusSchema = z.enum(['grounded', 'unverified']);

export const visualSourceSchema = z.object({
  itemId: z.string().min(1),
  quote: z.string().min(1),
  status: evidenceStatusSchema.describe('Copied onto the slide. Display does not change it.'),
});

/**
 * A number as it was supplied.
 *
 * `present` carries both the exact literal and the parsed value, including zero and negatives.
 * `missing` carries neither: absence is not the literal "0".
 */
export const measuredValueSchema = z.object({
  state: z.enum(['present', 'missing']),
  literal: z.string().min(1).optional(),
  value: z.number().finite().optional(),
});

export const visualComparisonSchema = z.object({
  base: measuredValueSchema,
  baseUnit: z.string(),
  basePeriod: z.string(),
});

export const kpiMeasureSchema = z.object({
  value: measuredValueSchema,
  unit: z.string(),
  unitAmbiguous: z.boolean(),
  caption: z.string().min(1),
  period: z.string(),
  periodKnown: z.boolean(),
  sources: z.array(visualSourceSchema).min(1),
  caveat: z.string().min(1).optional(),
  comparison: visualComparisonSchema.optional(),
});

export const visualCategorySchema = z.object({
  label: z.string().min(1),
  position: z.number().finite().optional(),
});

export const visualSeriesSchema = z.object({
  name: z.string().min(1),
  unit: z.string(),
  values: z.array(measuredValueSchema).min(1),
});

export const chartIntentSchema = z.enum(['category-comparison', 'time-series', 'part-of-whole']);

export const visualChartBlockSchema = z.object({
  kind: z.literal('chart'),
  intent: chartIntentSchema,
  categories: z.array(visualCategorySchema).min(1),
  series: z.array(visualSeriesSchema).min(1),
  requestedType: chartTypeSchema.optional(),
  xTitle: z.string(),
  yTitle: z.string(),
  sources: z.array(visualSourceSchema).min(1),
  caveat: z.string().min(1).optional(),
});

export const visualColumnSchema = z.object({
  header: z.string().min(1),
  kind: z.enum(['text', 'number', 'unit']),
});

export const visualCellSchema = z.object({
  text: z.string(),
  missing: z.boolean(),
});

export const visualTableBlockSchema = z.object({
  kind: z.literal('table'),
  columns: z.array(visualColumnSchema).min(1),
  rows: z.array(z.object({ cells: z.array(visualCellSchema).min(1) })).min(1),
  sources: z.array(visualSourceSchema).min(1),
  notes: z.string(),
  caveat: z.string().min(1).optional(),
});

export const kpiBlockInputSchema = z.object({
  kind: z.literal('kpi'),
  items: z.array(kpiMeasureSchema).min(1).max(8),
});

export const visualBlockSchema = z.discriminatedUnion('kind', [
  kpiBlockInputSchema,
  visualChartBlockSchema,
  visualTableBlockSchema,
]);

export const visualBuildRequestSchema = z.object({
  schemaVersion: z.literal(1),
  designSystem: designSystemSchema,
  variant: layoutVariantNameSchema,
  elementId: z.string().min(1),
  box: boxSchema,
  language: z.string().min(2),
  block: visualBlockSchema,
});

export const visualAdaptationSchema = z.object({
  id: z.enum([
    'as-placed',
    'smaller-type-step',
    'wrap-cells',
    'chart-beside-table',
    'chart-above-table',
    'table-above-chart',
  ]),
  keepsFacts: z.literal(true),
  fits: z.boolean(),
  detail: z.string().min(1),
});

export const visualFitSchema = z.object({
  fits: z.boolean(),
  overflow: z
    .object({
      code: z.enum(['text-overflow', 'table-overflow', 'cell-overflow']),
      lines: z.number().int().nonnegative(),
      emu: z.number().int().nonnegative(),
      detail: z.string().min(1),
    })
    .nullable(),
  adaptations: z.array(visualAdaptationSchema).min(1),
});

export const visualSignatureSchema = z.object({
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  tokens: z.array(z.string().min(1)).min(1),
});

export const visualFactSchema = z.object({
  kind: z.enum(['value', 'missing', 'delta', 'category', 'cell', 'note', 'source']),
  text: z.string(),
  unit: z.string().optional(),
  period: z.string().optional(),
  sourceStatus: evidenceStatusSchema.optional(),
});

export const visualIssueSchema = z.object({
  code: z.enum([
    'pie-unsuitable',
    'missing-rendered-as-zero',
    'table-row-loss',
    'mixed-unit-axis',
    'delta-on-zero-base',
    'source-status-upgraded',
  ]),
  message: z.string().min(1),
});

export const chartDecisionSchema = z.object({
  requested: chartTypeSchema.nullable(),
  used: z.array(chartTypeSchema),
  reason: z.string().min(1),
  pieRejected: z.boolean(),
  nativeAxis: z.enum(['category', 'xy', 'none']),
  splitByUnit: z.boolean(),
});

export const fontWarningSchema = z.object({
  role: z.string().min(1),
  requested: z.string().min(1),
  resolved: z.string().nullable(),
});

export const visualBuildResponseSchema = z.object({
  schemaVersion: z.literal(1),
  elements: z.array(slideElementSchema).min(1),
  reading: z.object({ facts: z.array(visualFactSchema).min(1) }),
  fit: visualFitSchema,
  signature: visualSignatureSchema,
  chart: chartDecisionSchema.nullable(),
  fontWarnings: z.array(fontWarningSchema),
  issues: z.array(visualIssueSchema),
  limitations: z.array(z.string()),
  deferred: z.array(z.string()).min(1),
});

export const visualCapabilitySchema = z.object({
  schemaVersion: z.literal(1),
  endpoint: z.string().min(1),
  callsModels: z.literal(false),
  kinds: z.array(z.enum(['kpi', 'chart', 'table'])).min(1),
  chartTypes: z.array(chartTypeSchema).min(1),
  variants: z.array(layoutVariantNameSchema).min(1),
  native: z.object({
    table: z.string().min(1),
    chartCategory: z.string().min(1),
    chartXy: z.string().min(1),
    kpi: z.string().min(1),
  }),
  preserves: z.array(z.string().min(1)).min(1),
  refuses: z.array(z.string().min(1)).min(1),
  deferred: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
});

export const visualSubjectSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['variant', 'control']),
  like: z.string().min(1).optional(),
  elements: z.array(slideElementSchema).min(1),
});

export const visualCompareRequestSchema = z.object({
  schemaVersion: z.literal(1),
  subjects: z.array(visualSubjectSchema).min(2),
});

export const visualCompareResponseSchema = z.object({
  schemaVersion: z.literal(1),
  signatures: z
    .array(z.object({ id: z.string().min(1), digest: z.string().regex(/^[0-9a-f]{64}$/) }))
    .min(1),
  variantsDistinct: z.boolean(),
  controls: z.array(
    z.object({
      id: z.string().min(1),
      like: z.string().min(1),
      collapsed: z.boolean(),
    }),
  ),
  accepted: z.boolean(),
});

export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;
export type MeasuredValue = z.infer<typeof measuredValueSchema>;
export type VisualBuildRequest = z.infer<typeof visualBuildRequestSchema>;
export type VisualBuildResponse = z.infer<typeof visualBuildResponseSchema>;
export type VisualCapability = z.infer<typeof visualCapabilitySchema>;
export type VisualCompareRequest = z.infer<typeof visualCompareRequestSchema>;
export type VisualCompareResponse = z.infer<typeof visualCompareResponseSchema>;
export type VisualSignature = z.infer<typeof visualSignatureSchema>;
