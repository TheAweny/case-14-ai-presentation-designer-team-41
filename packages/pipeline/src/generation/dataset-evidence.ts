import { datasetSchema, type Dataset } from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';

/** Server preparation, before timed generation. Paths are resolved/authorized by the API. */
export async function prepareDatasets(
  engine: Pick<EngineClient, 'extractDataset'>,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<Dataset[]> {
  return Promise.all(
    paths.map(async (path) => datasetSchema.parse(await engine.extractDataset({ path }, signal))),
  );
}

export const normalizeEvidence = (text: string) =>
  text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export interface DatasetFact {
  itemId: string;
  datasetId: string;
  sheetId: string;
  row: number;
  ref: string;
  metric: string;
  category: string;
  dimensions: { header: string; text: string }[];
  unit: string;
  state: 'present' | 'missing';
  value?: number;
  literal?: string;
  quote: string;
}

/** Header units are explicit, never inferred from neighbouring values or model captions. */
function measurementHeader(header: string): { metric: string; unit: string } {
  const match = /^(.*?)\s*(?:\(([^()]+)\)|,\s*([^,]+))$/u.exec(header.trim());
  return match
    ? { metric: (match[1] ?? '').trim(), unit: (match[2] ?? match[3] ?? '').trim() }
    : { metric: header.trim(), unit: '' };
}

const address = (dataset: string, sheet: string, cell: string) =>
  `dataset/${encodeURIComponent(dataset)}/${encodeURIComponent(sheet)}/${encodeURIComponent(cell)}`;

/** A nonempty evidence token for an explicitly empty cell; raw remains unchanged. */
export const datasetCellQuote = (cell: { kind: string; raw: string | null }) =>
  cell.kind === 'empty' ? 'null' : (cell.raw ?? 'null');

/**
 * Wide tables: named measure columns, textual/date row dimensions. Unknown headers, merged
 * relations and ambiguous readings are withheld. Each offered fact has one immutable cell
 * address and all its dimensions; selecting a cell never permits relabelling its metric.
 */
export function datasetFacts(datasets: readonly Dataset[]): DatasetFact[] {
  const facts: DatasetFact[] = [];
  for (const input of datasets) {
    const dataset = datasetSchema.parse(input);
    if (dataset.status === 'failed' || !dataset.datasetId || !dataset.source.sha256) continue;
    for (const sheet of dataset.sheets) {
      if (sheet.headerRow === null || sheet.state === 'hidden' || sheet.mergedRanges?.length)
        continue;
      const headers = sheet.columns.map((column) => normalizeEvidence(column.header ?? ''));
      if (headers.some((header) => !header) || new Set(headers).size !== headers.length) continue;
      for (const row of sheet.rows) {
        if (row.row === sheet.headerRow || row.cells.length !== sheet.columns.length) continue;
        if (row.cells.some((cell) => cell.candidates?.length)) continue;
        const dimensions = row.cells.flatMap((cell, i) => {
          const column = sheet.columns[i];
          return column &&
            (column.kind === 'text' || column.kind === 'date') &&
            (cell.kind === 'text' || cell.kind === 'date') &&
            cell.raw?.trim()
            ? [{ header: column.header ?? '', text: cell.raw.trim() }]
            : [];
        });
        // A missing dimension cannot become an implicit category or period.
        if (
          sheet.columns.some(
            (column, i) =>
              (column.kind === 'text' || column.kind === 'date') &&
              !dimensions.some((dimension) => dimension.header === column.header) &&
              row.cells[i]?.kind !== 'number',
          )
        )
          continue;
        for (const [i, cell] of row.cells.entries()) {
          const column = sheet.columns[i];
          if (!column?.header || column.kind !== 'number' || cell.candidates?.length) continue;
          if (!new RegExp(`^${column.ref}${row.row}$`, 'u').test(cell.ref)) continue;
          const present =
            cell.kind === 'number' &&
            typeof cell.value === 'number' &&
            Number.isFinite(cell.value) &&
            cell.raw !== null;
          const missing =
            cell.kind === 'empty' &&
            cell.value == null &&
            (cell.raw === null || cell.raw.trim() === '');
          if (!present && !missing) continue;
          const measure = measurementHeader(column.header);
          // The extractor deliberately retains raw currency/scales. A disagreement between
          // explicit header and cell units is not silently resolved.
          const rawUnit =
            cell.raw
              ?.replace(/[()+−‒–—-]/gu, '')
              .replace(/\d[\d\s.,]*/gu, '')
              .trim() ?? '';
          const cellUnit = rawUnit || cell.unit || '';
          if (
            measure.unit &&
            cellUnit &&
            normalizeEvidence(measure.unit) !== normalizeEvidence(cellUnit)
          )
            continue;
          if (!measure.metric) continue;
          // Diagnostics on an addressed cell/column take precedence over a model assertion.
          if (
            dataset.diagnostics.some(
              (diagnostic) =>
                diagnostic.severity !== 'info' &&
                (!diagnostic.sheet || diagnostic.sheet === sheet.name) &&
                (!diagnostic.ref || diagnostic.ref === cell.ref || diagnostic.ref === column.ref),
            )
          )
            continue;
          facts.push({
            itemId: address(dataset.datasetId, sheet.sheetId, cell.ref),
            datasetId: dataset.datasetId,
            sheetId: sheet.sheetId,
            row: row.row,
            ref: cell.ref,
            metric: measure.metric,
            category: dimensions.map((dimension) => dimension.text).join(' / '),
            dimensions,
            unit: measure.unit || cellUnit,
            state: present ? 'present' : 'missing',
            ...(present ? { value: cell.value as number, literal: cell.raw ?? '' } : {}),
            quote: datasetCellQuote(cell),
          });
        }
      }
    }
  }
  // Duplicate addresses cannot prove which prepared source was selected.
  const counts = new Map<string, number>();
  for (const fact of facts) counts.set(fact.itemId, (counts.get(fact.itemId) ?? 0) + 1);
  return facts.filter((fact) => counts.get(fact.itemId) === 1);
}

/** Complete addressed rows, including textual cells; no model-supplied cell addresses. */
export function datasetTableEvidence(datasets: readonly Dataset[]) {
  return datasets.flatMap((dataset) =>
    dataset.status === 'failed'
      ? []
      : dataset.sheets.map((sheet) => ({
          datasetId: dataset.datasetId,
          sheetId: sheet.sheetId,
          name: sheet.name,
          sourceHash: dataset.source.sha256,
          columns: sheet.columns.map((column) => ({ ref: column.ref, header: column.header })),
          rows: sheet.rows.map((row) => ({
            row: row.row,
            cells: row.cells.map((cell) => ({
              ...cell,
              itemId: address(dataset.datasetId, sheet.sheetId, cell.ref),
              quote: datasetCellQuote(cell),
            })),
          })),
        })),
  );
}

/** Refuse whole sheets beyond the prompt budget; never present a prefix as a full dataset. */
export function boundedDatasetEvidence(
  datasets: readonly Dataset[],
  limits = { maxCells: 256, maxChars: 24_000 },
) {
  const selected: Dataset[] = [];
  const withheld: { datasetId: string; sheetId: string; reason: string }[] = [];
  let cells = 0;
  let chars = 0;
  for (const input of datasets) {
    const dataset = datasetSchema.parse(input);
    for (const sheet of dataset.sheets) {
      const candidate = { ...dataset, sheets: [sheet] };
      const size = sheet.rows.reduce((sum, row) => sum + row.cells.length, sheet.columns.length);
      if (dataset.status === 'failed' || size + cells > limits.maxCells) {
        withheld.push({
          datasetId: dataset.datasetId,
          sheetId: sheet.sheetId,
          reason: dataset.status === 'failed' ? 'failed-extraction' : 'evidence-budget-exceeded',
        });
        continue;
      }
      const length = JSON.stringify({
        tables: datasetTableEvidence([candidate]),
        facts: datasetFacts([candidate]),
      }).length;
      if (length + chars > limits.maxChars) {
        withheld.push({
          datasetId: dataset.datasetId,
          sheetId: sheet.sheetId,
          reason: 'evidence-budget-exceeded',
        });
        continue;
      }
      selected.push(candidate);
      cells += size;
      chars += length;
    }
  }
  return {
    datasets: selected,
    facts: datasetFacts(selected),
    tables: datasetTableEvidence(selected),
    withheld,
  };
}
