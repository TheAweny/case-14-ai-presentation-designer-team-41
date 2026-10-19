import { z } from 'zod';

export const datasetCellKindSchema = z
  .union([
    z.literal('number'),
    z.literal('text'),
    z.literal('date'),
    z.literal('boolean'),
    z.literal('empty'),
  ])
  .meta({ title: 'DatasetCellKind' });
export const datasetDiagnosticSchema = z
  .strictObject({
    code: z.string(),
    severity: z
      .union([z.literal('error'), z.literal('warning'), z.literal('info')])
      .meta({ title: 'DatasetSeverity' }),
    message: z.string(),
    sheet: z.string().nullable().default(null).optional(),
    ref: z.string().nullable().default(null).optional(),
  })
  .meta({ title: 'DatasetDiagnostic' });
export const datasetCellSchema = z
  .strictObject({
    ref: z.string(),
    raw: z.string().nullable(),
    kind: datasetCellKindSchema,
    value: z.union([z.number(), z.string(), z.boolean(), z.null()]).default(null).optional(),
    unit: z.string().default('').optional(),
    candidates: z
      .array(z.union([z.number(), z.string()]))
      .default([])
      .optional(),
  })
  .meta({ title: 'DatasetCell' });
export const datasetColumnSchema = z
  .strictObject({
    columnId: z.string(),
    index: z.number().int(),
    ref: z.string(),
    header: z.string().nullable(),
    kind: datasetCellKindSchema,
    decimal: z.string().default('').optional(),
  })
  .meta({ title: 'DatasetColumn' });
export const datasetSheetSchema = z
  .strictObject({
    sheetId: z.string(),
    name: z.string(),
    index: z.number().int(),
    state: z
      .union([z.literal('visible'), z.literal('hidden')])
      .meta({ title: 'DatasetSheetState' })
      .default('visible')
      .optional(),
    range: z.string(),
    headerRow: z.number().int().nullable(),
    columns: z.array(datasetColumnSchema),
    rows: z.array(
      z
        .strictObject({ row: z.number().int(), cells: z.array(datasetCellSchema) })
        .meta({ title: 'DatasetRow' }),
    ),
    mergedRanges: z.array(z.string()).default([]).optional(),
  })
  .meta({ title: 'DatasetSheet' });

/** Deterministic table extraction; raw text and ambiguous readings remain available. */
export const datasetSourceSchema = z.strictObject({
  fileName: z.string(),
  mediaType: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
});

export const datasetRowSchema = z.strictObject({
  row: z.number().int(),
  cells: z.array(datasetCellSchema),
});

export const datasetSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1).optional(),
  datasetId: z.string(),
  status: z
    .union([z.literal('ok'), z.literal('partial'), z.literal('failed')])
    .meta({ title: 'DatasetStatus' }),
  source: datasetSourceSchema,
  sheets: z.array(datasetSheetSchema),
  diagnostics: z.array(datasetDiagnosticSchema),
});

export const datasetExtractRequestSchema = z.strictObject({ path: z.string() });
export type Dataset = z.infer<typeof datasetSchema>;
export type DatasetExtractRequest = z.infer<typeof datasetExtractRequestSchema>;
