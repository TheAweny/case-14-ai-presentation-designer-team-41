import { z } from 'zod';

/**
 * Read a slice of an uploaded text or spreadsheet file. The engine returns characters or cells;
 * it does not call a model and does not open a presentation.
 */
const boundedString = z.string().max(4_000);
const sheetNameSchema = z.string().min(1).max(200);
const cellRangeSchema = z
  .string()
  .max(4_000)
  .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/);
const materialFormatSchema = z.enum(['text', 'table']);

export const materialExtractRequestSchema = z.object({
  schemaVersion: z.literal(1),
  path: z.string().min(1).max(4_000),
  format: materialFormatSchema,
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  sheet: sheetNameSchema.optional(),
  range: cellRangeSchema.optional(),
});

const locatorSchema = z.object({
  page: z.number().int().positive().nullable(),
  paragraph: z.number().int().positive().nullable(),
  sheet: sheetNameSchema.nullable(),
  range: cellRangeSchema.nullable(),
});

const segmentSchema = z.object({
  index: z.number().int().nonnegative(),
  locator: locatorSchema,
  text: z.string().max(12_000),
});

const cellValueSchema = z.union([boundedString, z.number().finite(), z.boolean(), z.null()]);

const cellSchema = z.object({
  address: boundedString,
  row: z.number().int().positive(),
  column: z.number().int().positive(),
  value: cellValueSchema,
  formula: boundedString.nullable(),
  cached: z.boolean(),
});

const tableSchema = z.object({
  sheet: sheetNameSchema,
  range: cellRangeSchema,
  cells: z.array(cellSchema).max(200),
  mergedRanges: z.array(cellRangeSchema).max(200),
});

export const materialExtractResponseSchema = z.object({
  schemaVersion: z.literal(1),
  kind: materialFormatSchema,
  sourceSha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  segments: z.array(segmentSchema).max(100),
  table: tableSchema.nullable(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  needsOcr: z.boolean(),
  warnings: z.array(boundedString).max(20),
});

export type MaterialExtractRequest = z.infer<typeof materialExtractRequestSchema>;
export type MaterialExtractResponse = z.infer<typeof materialExtractResponseSchema>;
