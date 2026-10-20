import { join } from 'node:path';
import { datasetLabelsSchema, type Dataset, type DatasetLabels } from '@lct/contracts';
import { loadAgent } from '@lct/registry';
import type { TextProvider } from '../generation/provider.js';

/** Codes a column has when its distinct values are this few: 0/1, Y/N, 1–3. */
const FEW = 12;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Opaque identity, including the sheet: equal headers never share a label implicitly. */
export const datasetColumnKey = (sheetId: string, columnId: string): string =>
  JSON.stringify([sheetId, columnId]);

/** What the labeler sees of a table: names, kinds, a few values, and every code of a coded column. */
export function labelerInput(dataset: Dataset, brief: string) {
  const columns: {
    column: string;
    header: string;
    sheet: string;
    kind: string;
    units: string[];
    examples: string[];
    distinct?: string[];
  }[] = [];
  for (const sheet of dataset.sheets) {
    sheet.columns.forEach((column, index) => {
      const values = sheet.rows
        .map((row) => row.cells[index])
        .filter((cell) => cell !== undefined && cell.kind !== 'empty')
        .map((cell) => String(cell?.raw ?? cell?.value ?? '').trim())
        .filter(Boolean);
      const distinct = [...new Set(values)];
      columns.push({
        column: datasetColumnKey(sheet.sheetId, column.columnId),
        header: column.header ?? column.ref,
        sheet: sheet.name,
        kind: column.kind,
        units: [
          ...new Set(
            sheet.rows.flatMap((row) =>
              row.cells[index]?.unit ? [row.cells[index]?.unit ?? ''] : [],
            ),
          ),
        ],
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
  options.signal?.throwIfAborted();
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
      options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    );
    options.signal?.throwIfAborted();
    const known = new Map(input.columns.map((column) => [column.column, column]));
    const counts = new Map<string, number>();
    for (const entry of answer.columns)
      counts.set(entry.column, (counts.get(entry.column) ?? 0) + 1);
    return {
      rowsLabel: answer.rowsLabel,
      columns: answer.columns
        .filter((entry) => known.has(entry.column) && counts.get(entry.column) === 1)
        .map((entry) => ({
          ...entry,
          // A translation may not add a measurement scale absent from the column itself.
          label: (() => {
            const column = known.get(entry.column);
            const unit =
              /(?:,\s*|\()(%|₽|руб\.?|млн(?:\s*₽)?|млрд(?:\s*₽)?|тыс\.?(?:\s*₽)?|кг|км|м|шт\.?)\)?$/iu.exec(
                entry.label,
              )?.[1];
            const explicit =
              unit &&
              ((column?.units ?? []).some((value) => value.toLowerCase() === unit.toLowerCase()) ||
                new RegExp(`(?:^|[\\s,(])${escapeRegex(unit)}(?:$|[\\s,)])`, 'iu').test(
                  column?.header ?? '',
                ));
            return unit && !explicit
              ? entry.label.replace(/(?:,\s*|\()[^,(]+\)?$/u, '').trim() ||
                  column?.header ||
                  entry.label
              : entry.label;
          })(),
          // A binary code alone does not prove success/failure. Semantic labels need an exact
          // explicit mapping in the source brief; neutral groups need no interpretation.
          values: entry.values.filter((value) => {
            if (!known.get(entry.column)?.distinct?.includes(value.value)) return false;
            if (entry.values.filter((other) => other.value === value.value).length !== 1)
              return false;
            if (value.label === `Группа ${value.value}` || value.label === value.value) return true;
            if (
              input.columns.filter((other) => other.header === known.get(entry.column)?.header)
                .length !== 1
            )
              return false;
            const evidence = value.evidence?.trim();
            if (!evidence || !input.brief.includes(evidence)) return false;
            const header = known.get(entry.column)?.header ?? '';
            return new RegExp(
              `^${escapeRegex(header)}\\s*:\\s*${escapeRegex(value.value)}\\s*(?:=|—|–|:|-)\\s*${escapeRegex(value.label)}[.;]?$`,
              'iu',
            ).test(evidence);
          }),
        })),
    };
  } catch {
    options.signal?.throwIfAborted();
    return null;
  }
}
