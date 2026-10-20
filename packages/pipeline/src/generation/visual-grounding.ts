import type { Dataset, MeasuredValue, SlotVisual } from '@lct/contracts';
import { sourceBriefTexts } from './source-brief.js';
import {
  datasetCellQuote,
  datasetFacts,
  normalizeEvidence as norm,
  type DatasetFact,
} from './dataset-evidence.js';

interface Fact {
  metric: string;
  category: string;
  unit: string;
  state: 'present' | 'missing';
  value?: number;
  literal?: string;
}

const NUMBER = '[+−-]?(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d+)?';
const number = (literal: string) =>
  Number(
    literal
      .replace(/[\s\u00a0\u202f]/gu, '')
      .replace('−', '-')
      .replace(',', '.'),
  );
const equal = (left: string, right: string) => norm(left) === norm(right);
const sourceContains = (brief: string, quote: string) =>
  sourceBriefTexts(brief).some((text) => text.includes(quote));
const sameUnit = (left: string, right: string) =>
  equal(left.replace(/\.$/u, ''), right.replace(/\.$/u, ''));
const safeUnit = (unit: string) =>
  /^(?:%|(?:тыс\.?|млн|млрд)\s*(?:₽|руб\.?|долл\.?|\$|€)?|₽|руб\.?|\$|€|шт\.?|чел\.?|кг|км|м|с|сек\.?|мин\.?|час(?:а|ов)?)?$/iu.test(
    unit.trim(),
  );

/** A deliberately small grammar for explicit textual records, never a bag of figures.
 * Examples: "Выручка: Q1 10, Q2 20 млн ₽"; "Выручка: -10 млн ₽".
 * Prose, absent metric names, ambiguous decimals and inferred relations stay unverified.
 */
export function textFacts(brief: string): Fact[] {
  const facts: Fact[] = [];
  // Periods inside units/decimals are retained; a sentence boundary starts a new record.
  const records = brief.split(/(?:\r?\n|;|[.!?]\s+(?=[\p{L}]))/u);
  for (const record of records) {
    const match = /^\s*([^:]+):\s*(.+?)\s*[.!]?\s*$/u.exec(record);
    if (!match) continue;
    const metric = match[1]?.trim() ?? '';
    const body = match[2] ?? '';
    if (!metric || /[{}[\]"\n]/u.test(metric)) continue;
    const entries = body.split(/,\s+(?=[\p{L}])/u);
    const parsed: Fact[] = [];
    for (const entry of entries) {
      const cell = new RegExp(`^(?:(.*?)\\s+)?(${NUMBER})(?:\\s*(.*?))?[.!]?$`, 'u').exec(
        entry.trim(),
      );
      if (!cell) break;
      // A leading four-digit period followed by a measurement is a category, not the value.
      const annual = new RegExp(`^(\\d{4})\\s+(${NUMBER})\\s*(.*?)$`, 'u').exec(entry.trim());
      const parsedCell = annual ?? cell;
      const literal = parsedCell[2] ?? '';
      const unit = (parsedCell[3] ?? '').trim().replace(/\.$/u, '');
      // Without a column's decimal hints, 1,234 could be 1234 or 1.234.
      if (/^[+−-]?\d{1,3}[,.]\d{3}$/u.test(literal) || !safeUnit(unit)) break;
      parsed.push({
        metric,
        category: parsedCell[1]?.trim() ?? '',
        unit,
        state: 'present',
        value: number(literal),
        literal,
      });
    }
    if (parsed.length !== entries.length) continue;
    const units = new Set(parsed.map((fact) => norm(fact.unit)).filter(Boolean));
    // A single trailing unit scopes the whole explicitly enumerated series.
    if (units.size > 1) continue;
    const unit = parsed.find((fact) => fact.unit)?.unit ?? '';
    facts.push(...parsed.map((fact) => ({ ...fact, unit: fact.unit || unit })));
  }
  return facts;
}

interface SeriesLine {
  metric: string;
  /** The column the rows were grouped by, from the section heading; empty when not quoted. */
  grouping: string;
  facts: Fact[];
}

/**
 * The ready series of a brief's data section, one per line under its heading:
 * «Готовые ряды для графиков, точные значения по «result»:» then
 * «- cloud_cover, среднее: 0 — 43,33, 1 — 30,83.». The pipeline wrote these lines from the
 * table itself (decimal comma, no digit grouping), so each value is a fact of its metric and
 * category. Every entry of a line must parse, or the line proves nothing.
 */
function seriesLines(text: string): SeriesLine[] {
  const entry = new RegExp(`^(.+?) — (${NUMBER})$`, 'u');
  const result: SeriesLine[] = [];
  let grouping = '';
  for (const line of text.split(/\r?\n/u)) {
    const heading = /точные значения по «([^»]+)»:\s*$/u.exec(line);
    if (heading) {
      grouping = heading[1] ?? '';
      continue;
    }
    const match = /^\s*(?:-\s+)?([^:]+):\s+(.+?)\.?\s*$/u.exec(line);
    if (!match) continue;
    const metric = (match[1] ?? '').trim();
    const parsed = (match[2] ?? '').split(/, (?=[^,]* — )/u).map((part) => entry.exec(part.trim()));
    if (!metric || parsed.length < 2 || parsed.some((part) => !part)) continue;
    result.push({
      metric,
      grouping,
      facts: parsed.map((part) => ({
        metric,
        category: (part?.[1] ?? '').trim(),
        unit: '',
        state: 'present' as const,
        value: number(part?.[2] ?? ''),
        literal: part?.[2] ?? '',
      })),
    });
  }
  return result;
}

/** The least difference, as a share of the largest bar, a planned chart has to show. */
const SPREAD = 0.05;

/** Bars within a few percent of each other show nothing but a cropped axis. */
function spread(line: SeriesLine): boolean {
  const values = line.facts.map((fact) => fact.value ?? 0);
  const least = Math.min(...values);
  const most = Math.max(...values);
  return most - least >= SPREAD * Math.max(Math.abs(least), Math.abs(most));
}

/** Whether a purpose quotes a ready series line by its name («cloud_cover, среднее: …»). */
export const quotesSeries = (purpose: string, brief: string): boolean =>
  seriesLines(brief).some((line) => norm(purpose).includes(`${norm(line.metric)}:`));

export const seriesFacts = (text: string): Fact[] =>
  seriesLines(text).flatMap((line) => line.facts);

/**
 * The chart a data slide was planned around, built from the ready series its purpose quotes: a
 * line whose column the purpose names and two of whose values it repeats, or every value of which
 * it repeats («облачность 43,33 против 30,83»). The figures come from the brief's line, never from
 * the purpose, so a misquoted value cannot reach the chart.
 */
export function plannedSeriesChart(
  purpose: string,
  brief: string,
  slotId: string,
): SlotVisual | null {
  const target = norm(purpose);
  const says = (literal: string) =>
    new RegExp(`(?<![\\d.,])${literal.replace(/[.+]/gu, '\\$&')}(?![\\d]|[.,]\\d)`, 'u').test(
      target,
    );
  // The most specific quote wins: a named column first, then the longer figures it repeats
  // («43,33» says more than «6»).
  let best: { line: SeriesLine; score: number } | null = null;
  for (const line of seriesLines(brief)) {
    if (line.facts.length > 8 || !spread(line)) continue;
    const column = norm(line.metric.split(',')[0] ?? '');
    const said = line.facts.filter((fact) => says(norm(fact.literal ?? '')));
    const named = Boolean(column) && target.includes(column);
    if (!((named && said.length >= 2) || said.length === line.facts.length)) continue;
    const score =
      (named ? 1000 : 0) + said.reduce((sum, fact) => sum + (fact.literal ?? '').length, 0);
    if (!best || score > best.score) best = { line, score };
  }
  if (!best) return null;
  const values = best.line.facts.map((fact) => fact.value ?? 0);
  return verifyVisual(
    {
      kind: 'chart',
      slotId,
      chartType: 'column',
      categories: best.line.facts.map((fact) => fact.category),
      series: [{ name: best.line.metric, values }],
      xTitle: best.line.grouping,
      yTitle: '',
    },
    brief,
  );
}

function matches(fact: Fact, metric: string, category: string, unit: string, value: MeasuredValue) {
  if (!equal(fact.metric, metric) || !equal(fact.category, category) || !sameUnit(fact.unit, unit))
    return false;
  if (value.state === 'missing')
    return fact.state === 'missing' && value.value === undefined && value.literal === undefined;
  if (fact.state !== 'present' || value.value === undefined || value.literal === undefined)
    return false;
  // Dataset literals may carry a unit or a locale selected by Python. Match raw first; only
  // parse a model literal if it is a bare, unambiguous signed number.
  const literalMatches =
    equal(fact.literal ?? '', value.literal) ||
    (new RegExp(`^${NUMBER}$`, 'u').test(value.literal) &&
      !/^[+−-]?\d{1,3}[,.]\d{3}$/u.test(value.literal) &&
      number(value.literal) === fact.value);
  return fact.value === value.value && literalMatches;
}

type Source = { itemId: string; quote: string; status: string };
/** A unique exact table header anchors the full original table, never arbitrary nearby prose. */
function expandTableQuote(quote: string, brief: string): string {
  if (quote.includes('\n') || !quote.includes('|')) return quote;
  const anchor = quote
    .trim()
    .replace(/^\||\|$/gu, '')
    .trim();
  const matches = sourceBriefTexts(brief)
    .flatMap((source) => source.split(/\r?\n\s*\r?\n/u))
    .filter(
      (block) =>
        block
          .trim()
          .split(/\r?\n/u)[0]
          ?.trim()
          .replace(/^\||\|$/gu, '')
          .trim() === anchor && textTables(block).length === 1,
    );
  return matches.length === 1 ? (matches[0]?.trim() ?? quote) : quote;
}
function sourcedFacts(
  sources: readonly Source[],
  brief: string,
  prepared: readonly DatasetFact[],
): Fact[] | null {
  if (!sources.length) return null;
  const facts: Fact[] = [];
  for (const source of sources) {
    if (source.itemId === 'brief') {
      if (
        !source.quote.trim() ||
        !sourceBriefTexts(brief).some((text) => text.includes(source.quote))
      )
        return null;
      facts.push(
        ...textFacts(source.quote),
        ...tableFacts(source.quote),
        ...seriesFacts(source.quote),
      );
    } else {
      const fact = prepared.find((entry) => entry.itemId === source.itemId);
      if (!fact || source.quote !== fact.quote) return null;
      facts.push(fact);
    }
  }
  return facts;
}

function proven(
  facts: readonly Fact[],
  metric: string,
  category: string,
  unit: string,
  value: MeasuredValue,
) {
  const candidates = facts.filter(
    (fact) =>
      equal(fact.metric, metric) && equal(fact.category, category) && sameUnit(fact.unit, unit),
  );
  return (
    candidates.length > 0 &&
    candidates.every((fact) => matches(fact, metric, category, unit, value))
  );
}

/** Expose only human-visible facts to coverage; metadata/sources never prove visible content. */
export function visualVisibleText(visual: SlotVisual): string[] {
  if (visual.kind === 'table')
    return [visual.headers.join(' | '), ...visual.rows.map((row) => row.join(' | '))];
  if (visual.kind === 'chart')
    return visual.series.flatMap((series) =>
      visual.categories.map(
        (category, i) => `${series.name}: ${category} ${series.values[i]} ${visual.yTitle}`,
      ),
    );
  const block = visual.block;
  if (block.kind === 'kpi')
    return block.items.map(
      (item) =>
        `${item.caption}: ${item.periodKnown ? item.period : ''} ${item.value.state === 'present' ? item.value.literal : 'Нет данных'} ${item.unit}`,
    );
  if (block.kind === 'chart')
    return block.series.flatMap((series) =>
      block.categories.map(
        (category, i) =>
          `${series.name}: ${category.label} ${series.values[i]?.state === 'present' ? series.values[i]?.literal : 'Нет данных'} ${series.unit}`,
      ),
    );
  return [
    block.columns.map((column) => column.header).join(' | '),
    ...block.rows.map((row) =>
      row.cells.map((cell) => (cell.missing ? 'Нет данных' : cell.text)).join(' | '),
    ),
    block.notes,
  ];
}

function datasetTable(
  headers: readonly string[],
  rows: readonly { text: string; missing: boolean }[][],
  datasets: readonly Dataset[],
  sources?: readonly Source[],
): boolean {
  if (
    sources?.some(
      (entry) =>
        !datasets.some((dataset) =>
          dataset.sheets.some((sheet) =>
            sheet.rows.some((row) =>
              row.cells.some(
                (cell) =>
                  entry.itemId ===
                    `dataset/${encodeURIComponent(dataset.datasetId)}/${encodeURIComponent(sheet.sheetId)}/${encodeURIComponent(cell.ref)}` &&
                  entry.quote === datasetCellQuote(cell),
              ),
            ),
          ),
        ),
    )
  )
    return false;
  // Keep complete row/column relationships, including textual dimensions. Arbitrary reordering
  // of columns is safe only when the header and every addressed cell travel together.
  return datasets.some(
    (dataset) =>
      dataset.status !== 'failed' &&
      dataset.sheets.some((sheet) => {
        if (sheet.state === 'hidden' || sheet.headerRow === null || sheet.mergedRanges?.length)
          return false;
        const indexes = headers.map((header) => {
          const matches = sheet.columns.flatMap((column, i) =>
            equal(column.header ?? '', header) ? [i] : [],
          );
          return matches.length === 1 ? matches[0] : undefined;
        });
        if (
          indexes.some((index) => index === undefined) ||
          new Set(indexes).size !== indexes.length
        )
          return false;
        return rows.every(
          (row) =>
            row.length === headers.length &&
            sheet.rows.some((sourceRow) =>
              row.every((cell, i) => {
                const columnIndex = indexes[i];
                const source = columnIndex === undefined ? undefined : sourceRow.cells[columnIndex];
                const column = columnIndex === undefined ? undefined : sheet.columns[columnIndex];
                if (
                  !source ||
                  !column ||
                  source.ref !== `${column.ref}${sourceRow.row}` ||
                  source.candidates?.length
                )
                  return false;
                if (
                  dataset.diagnostics.some(
                    (diagnostic) =>
                      diagnostic.severity !== 'info' &&
                      (!diagnostic.sheet || diagnostic.sheet === sheet.name) &&
                      (!diagnostic.ref ||
                        diagnostic.ref === source.ref ||
                        diagnostic.ref === sheet.columns[columnIndex ?? -1]?.ref),
                  )
                )
                  return false;
                if (
                  sources &&
                  !sources.some(
                    (entry) =>
                      entry.itemId ===
                        `dataset/${encodeURIComponent(dataset.datasetId)}/${encodeURIComponent(sheet.sheetId)}/${encodeURIComponent(source.ref)}` &&
                      entry.quote === datasetCellQuote(source),
                  )
                )
                  return false;
                return cell.missing
                  ? source.kind === 'empty' &&
                      source.value == null &&
                      (source.raw === null || source.raw.trim() === '') &&
                      !cell.text.trim()
                  : source.kind !== 'empty' && source.raw !== null && equal(source.raw, cell.text);
              }),
            ),
        );
      }),
  );
}

interface TextTable {
  headers: string[];
  rows: string[][];
}

/** Only columns explicitly naming a metric and unit; no units inferred from nearby prose. */
function tableFacts(brief: string): Fact[] {
  return textTables(brief).flatMap((table) => {
    const first = table.headers[0] ?? '';
    if (!/^(?:месяц|период|категория|month|period|category)$/iu.test(first)) return [];
    return table.headers.flatMap((header, index) => {
      const label = /^(.+?),\s*(.+)$/u.exec(header);
      if (index === 0 || !label?.[1] || !label[2] || !safeUnit(label[2])) return [];
      return table.rows.flatMap((row): Fact[] => {
        const literal = row[index] ?? '';
        const category = row[0] ?? '';
        if (!category) return [];
        if (literal === '' || /^(?:нет данных|н\/д|n\/a)$/iu.test(literal))
          return [{ metric: label[1] ?? '', unit: label[2] ?? '', category, state: 'missing' }];
        if (
          !new RegExp(`^${NUMBER}$`, 'u').test(literal) ||
          /^[+−-]?\d{1,3}[,.]\d{3}$/u.test(literal)
        )
          return [];
        return [
          {
            metric: label[1] ?? '',
            unit: label[2] ?? '',
            category,
            state: 'present',
            literal,
            value: number(literal),
          },
        ];
      });
    });
  });
}
/** Only explicit, rectangular Markdown/TSV tables with a header; no guessed prose columns. */
export function textTables(brief: string): TextTable[] {
  const result: TextTable[] = [];
  for (const source of sourceBriefTexts(brief))
    for (const block of source.split(/\r?\n\s*\r?\n/u)) {
      const lines = block.trim().split(/\r?\n/u);
      if (lines.length < 2 || lines.length > 128) continue;
      const delimiter = lines[0]?.includes('\t') ? '\t' : '|';
      const rows = lines.map((line) => {
        const stripped = delimiter === '|' ? line.trim().replace(/^\||\|$/gu, '') : line;
        return stripped.split(delimiter).map((cell) => cell.trim());
      });
      const headers = rows.shift();
      if (
        !headers ||
        headers.length < 2 ||
        headers.length > 8 ||
        headers.some((header) => !header) ||
        new Set(headers.map(norm)).size !== headers.length
      )
        continue;
      if (rows[0]?.every((cell) => /^:?-{3,}:?$/u.test(cell))) rows.shift();
      if (!rows.length || rows.some((row) => row.length !== headers.length)) continue;
      result.push({ headers, rows });
    }
  return result;
}

function textTable(
  headers: readonly string[],
  rows: readonly { text: string; missing: boolean }[][],
  brief: string,
  sources?: readonly Source[],
) {
  if (
    sources?.some(
      (source) =>
        source.itemId !== 'brief' ||
        !source.quote.trim() ||
        !sourceBriefTexts(brief).some((text) => text.includes(source.quote)),
    )
  )
    return false;
  const tables = sources
    ? sources.flatMap((source) => textTables(source.quote))
    : textTables(brief);
  return tables.some((table) => {
    const indexes = headers.map((header) =>
      table.headers.findIndex((entry) => equal(entry, header)),
    );
    if (indexes.some((index) => index < 0) || new Set(indexes).size !== indexes.length)
      return false;
    return rows.every(
      (row) =>
        row.length === headers.length &&
        table.rows.some((original) =>
          row.every((cell, i) => {
            const value = original[indexes[i] ?? -1];
            return (
              value !== undefined &&
              (cell.missing
                ? value === '' && cell.text === ''
                : value !== '' && equal(value, cell.text))
            );
          }),
        ),
    );
  });
}

/** A refusal leaves the slot's writer text intact. Unknown provenance never becomes grounded. */
export function verifyVisual(
  visual: SlotVisual | null | undefined,
  brief: string,
  datasets: readonly Dataset[] = [],
): SlotVisual | null {
  if (!visual) return null;
  // A model's status is not evidence. Only the checks below can return this promoted copy.
  visual = structuredClone(visual);
  if (visual.kind === 'native') {
    const refs =
      visual.block.kind === 'kpi'
        ? visual.block.items.flatMap((item) => item.sources)
        : visual.block.sources;
    for (const source of refs) {
      if (source.itemId === 'brief') source.quote = expandTableQuote(source.quote, brief);
      source.status = 'grounded';
    }
  }
  const prepared = datasetFacts(datasets);
  if (visual.kind === 'table')
    return datasetTable(
      visual.headers,
      visual.rows.map((row) => row.map((text) => ({ text, missing: false }))),
      datasets,
    ) ||
      textTable(
        visual.headers,
        visual.rows.map((row) => row.map((text) => ({ text, missing: false }))),
        brief,
      )
      ? visual
      : null;
  if (visual.kind === 'chart') {
    const facts = [
      ...sourceBriefTexts(brief).flatMap((text) => [
        ...textFacts(text),
        ...tableFacts(text),
        ...seriesFacts(text),
      ]),
      ...prepared,
    ];
    return visual.categories.length >= 2 &&
      visual.series.every(
        (series) =>
          series.values.length === visual.categories.length &&
          series.values.every((value, i) =>
            proven(facts, series.name, visual.categories[i] ?? '', visual.yTitle, {
              state: 'present',
              value,
              literal: String(value),
            }),
          ),
      )
      ? visual
      : null;
  }
  const block = visual.block;
  const sources =
    block.kind === 'kpi' ? block.items.flatMap((item) => item.sources) : block.sources;
  if (block.kind === 'table') {
    if (
      (block.notes && !sourceContains(brief, block.notes)) ||
      (block.caveat && !sourceContains(brief, block.caveat))
    )
      return null;
    return datasetTable(
      block.columns.map((column) => column.header),
      block.rows.map((row) => row.cells),
      datasets,
      sources,
    ) ||
      textTable(
        block.columns.map((column) => column.header),
        block.rows.map((row) => row.cells),
        brief,
        sources,
      )
      ? visual
      : null;
  }
  if (block.kind === 'kpi')
    return block.items.every((item) => {
      const facts = sourcedFacts(item.sources, brief, prepared);
      if (
        !facts ||
        item.unitAmbiguous ||
        (!item.periodKnown && item.period.trim()) ||
        (item.caveat && !sourceContains(brief, item.caveat))
      )
        return false;
      const category = item.periodKnown ? item.period : '';
      return (
        proven(facts, item.caption, category, item.unit, item.value) &&
        (!item.comparison ||
          proven(
            facts,
            item.caption,
            item.comparison.basePeriod,
            item.comparison.baseUnit,
            item.comparison.base,
          ))
      );
    })
      ? visual
      : null;
  const facts = sourcedFacts(block.sources, brief, prepared);
  if (
    !facts ||
    (block.caveat && !sourceContains(brief, block.caveat)) ||
    block.categories.some((category) => category.position !== undefined)
  )
    return null;
  if (block.yTitle && !block.series.every((series) => equal(series.unit, block.yTitle)))
    return null;
  return block.series.every(
    (series) =>
      series.values.length === block.categories.length &&
      series.values.every((value, i) =>
        proven(facts, series.name, block.categories[i]?.label ?? '', series.unit, value),
      ),
  )
    ? visual
    : null;
}
