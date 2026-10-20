import { join } from 'node:path';
import { datasetLabelsSchema, type Dataset, type DatasetLabels } from '@lct/contracts';
import { loadAgent } from '@lct/registry';
import type { TextProvider } from '../generation/provider.js';

/** Codes a column has when its distinct values are this few: 0/1, Y/N, 1–3. */
const FEW = 12;

/** What the labeler sees of a table: names, kinds, a few values, and every code of a coded column. */
export function labelerInput(dataset: Dataset, brief: string) {
  const seen = new Set<string>();
  const columns: {
    column: string;
    kind: string;
    examples: string[];
    distinct?: string[];
  }[] = [];
  for (const sheet of dataset.sheets) {
    sheet.columns.forEach((column, index) => {
      const name = column.header ?? column.ref;
      if (seen.has(name)) return;
      seen.add(name);
      const values = sheet.rows
        .map((row) => row.cells[index])
        .filter((cell) => cell !== undefined && cell.kind !== 'empty')
        .map((cell) => String(cell?.raw ?? cell?.value ?? '').trim())
        .filter(Boolean);
      const distinct = [...new Set(values)];
      columns.push({
        column: name,
        kind: column.kind,
        examples: distinct.slice(0, 5),
        ...(distinct.length <= FEW ? { distinct } : {}),
      });
    });
  }
  return { brief: brief.slice(0, 4000), columns: columns.slice(0, 200) };
}

/**
 * Human labels for the columns of a data file, asked of the `data-labeler` agent once while the
 * file is prepared. Any failure — no model, a timeout, an answer off-schema — leaves the file's own
 * names: the brief is then as it was, never wrong. Labels for columns the file does not have are
 * dropped, so a label always points at real cells.
 */
export async function labelDataset(options: {
  provider: TextProvider;
  registryDir: string;
  dataset: Dataset;
  brief: string;
  signal?: AbortSignal;
}): Promise<DatasetLabels | null> {
  const input = labelerInput(options.dataset, options.brief);
  if (input.columns.length === 0) return null;
  try {
    const agent = await loadAgent(join(options.registryDir, 'data-labeler'));
    options.provider.setAgentGeneration?.('data-labeler', agent.config.generation);
    const answer = await options.provider.generate(
      'data-labeler',
      agent.instructions,
      input,
      datasetLabelsSchema,
      options.signal ?? AbortSignal.timeout(120_000),
    );
    const known = new Map(input.columns.map((column) => [column.column, column]));
    return {
      rowsLabel: answer.rowsLabel,
      columns: answer.columns
        .filter((entry) => known.has(entry.column))
        .map((entry) => ({
          ...entry,
          values: entry.values.filter((value) =>
            known.get(entry.column)?.distinct?.includes(value.value),
          ),
        })),
    };
  } catch {
    return null;
  }
}
