import type { Dataset } from '@lct/contracts';

type Sheet = Dataset['sheets'][number];
type Cell = Sheet['rows'][number]['cells'][number];
type Diagnostic = Dataset['diagnostics'][number];

/** A sheet longer than this is summarised over every row, with its first rows shown. */
export const FULL_TABLE_CHARS = 16_000;
/** Rows a summarised sheet still shows, so the writer sees what a row looks like. */
export const SAMPLE_ROWS = 20;
/** Distinct values a text column may have and still be listed whole with its counts. */
const LISTED_VALUES = 12;
const TOP_VALUES = 5;
/** Fewer values than this say nothing about which of them stand apart. */
const OUTLIER_SAMPLE = 8;
/** How many interquartile ranges beyond a quartile make a value stand apart. */
const OUTLIER_FENCE = 3;
const OUTLIERS_SHOWN = 5;
/** A number column with this few distinct values is a code (0 and 1, a score): count each. */
const FEW_NUMBERS = 6;
const NEWLINE = String.fromCharCode(10);

/** What each engine diagnostic means to the person who reads the brief. */
const NOTES: Readonly<Record<string, string>> = {
  'encoding-guessed': 'файл не в UTF-8 и прочитан как Windows-1251',
  'ragged-rows':
    'в части строк другое число полей; недостающие поля пусты, ни одна строка не отброшена',
  'mixed-column': 'в числовом столбце есть ячейки с текстом; у них нет числового значения',
  'mixed-decimal-separators': 'в столбце дроби записаны и через точку, и через запятую',
  'ambiguous-number':
    'часть чисел читается двояко (например, «1,234»); значение для них не выбрано',
  'ambiguous-date': 'часть дат читается двояко (день и месяц); дата для них не выбрана',
  'duplicate-header': 'у нескольких столбцов одинаковое название',
  'no-header': 'строки названий нет; столбцы названы буквами',
  'nested-value': 'часть значений — вложенные объекты или списки; они оставлены текстом JSON',
  'key-value-table': 'объект прочитан как таблица «ключ — значение»',
  'markup-removed': 'с ячеек снято оформление Markdown (жирный, код), чтобы прочитать значения',
  'merged-cells': 'есть объединённые ячейки; значение стоит в первой ячейке объединения',
  'formula-without-value': 'у части формул нет сохранённого результата; эти ячейки пусты',
  'cell-error': 'часть ячеек — ошибки таблицы (#DIV/0!, #N/A); у них нет значения',
  'empty-sheet': 'лист пуст',
};

/** Why a file gives no table, in words for the person who uploaded it. */
const REFUSALS: Readonly<Record<string, string>> = {
  'empty-file': 'файл пустой',
  'too-large': 'файл слишком большой, а читать его частично нельзя',
  unreadable: 'файл повреждён или это не таблица',
  'unsupported-format': 'старый формат .xls не читается — сохраните книгу как .xlsx',
  'no-table': 'в файле нет таблицы',
  'no-data': 'в файле нет данных',
  'sheet-missing': 'в книге нет листа, на который она ссылается',
};

/** The reason a failed dataset gives, ready to show to a person. */
export function datasetRefusal(dataset: Dataset): string {
  const errors = dataset.diagnostics.filter((item) => item.severity === 'error');
  const reasons = [...new Set(errors.map((item) => REFUSALS[item.code] ?? item.message))];
  return reasons.length > 0 ? reasons.join('; ') : 'в файле нет таблицы';
}

/**
 * The tables of a data file as text for a brief. A table is shown whole while it is short; a
 * long one is summarised over every row and shows its first rows, and says so. Values are written
 * as the file wrote them, so a figure on a slide can be found in the brief; a gap stays a gap.
 */
export function datasetText(dataset: Dataset): string {
  const parts = [`Данные из файла «${dataset.source.fileName}».`];
  const general = notes(dataset.diagnostics.filter((item) => !item.sheet));
  if (general) parts.push(`При чтении: ${general}.`);
  for (const sheet of dataset.sheets) parts.push(sheetText(dataset, sheet, tableNumber(dataset)));
  return parts.join(NEWLINE + NEWLINE);
}

/**
 * What a text file with tables inside says about them, written after the text itself: the text
 * already holds every row, so only the shape and the reading of each table is added.
 */
export function embeddedTablesText(dataset: Dataset): string {
  const lines = [`Таблицы в тексте файла «${dataset.source.fileName}»: ${dataset.sheets.length}.`];
  for (const [index, sheet] of dataset.sheets.entries()) {
    const columns = sheet.columns
      .map((column) => `${column.header ?? column.ref} — ${KIND[column.kind] ?? column.kind}`)
      .join('; ');
    const note = notes(sheetDiagnostics(dataset, sheet));
    lines.push(
      `Таблица ${index + 1}: ${sheet.rows.length} ${plural(sheet.rows.length, 'строка', 'строки', 'строк')}` +
        `, столбцы: ${columns}.` +
        (note ? ` При чтении: ${note}.` : ''),
    );
  }
  return lines.join(NEWLINE);
}

const KIND: Readonly<Record<string, string>> = {
  number: 'число',
  text: 'текст',
  date: 'дата',
  boolean: 'да/нет',
  empty: 'пусто',
};

function tableNumber(dataset: Dataset): (sheet: Sheet) => string {
  return (sheet) =>
    dataset.sheets.length === 1 ? 'Таблица' : `Лист ${sheet.index + 1} «${sheet.name}»`;
}

function sheetDiagnostics(dataset: Dataset, sheet: Sheet): Diagnostic[] {
  return dataset.diagnostics.filter((item) => item.sheet === sheet.name);
}

function notes(diagnostics: readonly Diagnostic[]): string {
  const said = new Set<string>();
  for (const item of diagnostics) {
    if (item.code === 'preamble-rows' || item.code === 'total-row') continue;
    const written = item.message.match(/\((«.+?»(?:, «.+?»)*)\)/)?.[1];
    const note =
      item.code === 'missing-markers'
        ? `пропуски записаны словами (${written ?? '«н/д»'}); это пропуски, а не нули`
        : NOTES[item.code];
    if (note) said.add(note);
  }
  return [...said].join('; ');
}

function sheetText(dataset: Dataset, sheet: Sheet, title: (sheet: Sheet) => string): string {
  const own = sheetDiagnostics(dataset, sheet);
  const head = `${title(sheet)}${sheet.state === 'hidden' ? ' (скрытый лист)' : ''}`;
  if (sheet.rows.length === 0 && sheet.columns.length === 0) return `${head}: лист пуст.`;
  const lines: string[] = [];
  const count = sheet.rows.length;
  lines.push(
    `${head}: ${count} ${plural(count, 'строка', 'строки', 'строк')}, ` +
      `${sheet.columns.length} ${plural(sheet.columns.length, 'столбец', 'столбца', 'столбцов')}.`,
  );
  const preamble = own.find((item) => item.code === 'preamble-rows');
  const above = preamble?.message.match(/«(.+)»/s)?.[1];
  if (above) lines.push(`Над таблицей написано: «${above}».`);
  lines.push(
    'Столбцы: ' +
      sheet.columns
        .map((column) => `${column.header ?? column.ref} — ${KIND[column.kind] ?? column.kind}`)
        .join('; ') +
      '.',
  );
  const note = notes(own);
  if (note) lines.push(`При чтении: ${note}.`);
  const totalRow = totalRowOf(own);
  const totalLabel = sheet.rows
    .find((row) => row.row === totalRow)
    ?.cells.find((cell) => cell.kind === 'text')?.raw;
  if (totalRow !== null && totalLabel) {
    lines.push(
      `Последняя строка «${clean(totalLabel)}» — итог по строкам выше; в сводке её нет, ` +
        'чтобы не посчитать дважды.',
    );
  }

  const spreadsheet = dataset.source.mediaType.includes('spreadsheetml');
  const header = sheet.columns.map((column) => clean(column.header ?? column.ref));
  const body = sheet.rows.map((row) => row.cells.map((cell) => cellText(cell, spreadsheet)));
  const counted = sheet.rows.filter((row) => row.row !== totalRow);
  const apart = outlierNote(sheet, counted);
  if (apart) lines.push(apart);
  const full = table(header, body);
  if (full.length <= FULL_TABLE_CHARS) {
    // Even a short table gets its counts: a model that tallies thirty rows by eye miscounts,
    // and a figure on a slide should be one the brief states, not one the model worked out.
    lines.push(
      `Точные подсчёты по ${counted.length} ` +
        `${plural(counted.length, 'строке', 'строкам', 'строкам')} — берите числа отсюда, не считайте заново:`,
    );
    lines.push(summary(sheet, counted, spreadsheet));
    lines.push(full);
    return lines.join(NEWLINE);
  }
  lines.push(
    `Таблица длинная, поэтому ниже сводка по всем ${counted.length} ` +
      `${plural(counted.length, 'строке', 'строкам', 'строкам')} и первые ${SAMPLE_ROWS} строк. ` +
      'Остальные строки в этот текст не вошли, но в сводке посчитаны.',
  );
  lines.push(summary(sheet, counted, spreadsheet));
  lines.push(`Первые ${SAMPLE_ROWS} строк:`);
  lines.push(table(header, body.slice(0, SAMPLE_ROWS)));
  return lines.join(NEWLINE);
}

function totalRowOf(diagnostics: readonly Diagnostic[]): number | null {
  const ref = diagnostics.find((item) => item.code === 'total-row')?.ref;
  const row = ref?.match(/\d+$/)?.[0];
  return row ? Number(row) : null;
}

function summary(sheet: Sheet, rows: Sheet['rows'], spreadsheet: boolean): string {
  return sheet.columns
    .map((column, index) => {
      const name = column.header ?? column.ref;
      const cells = rows.map((row) => row.cells[index]).filter((cell) => cell !== undefined);
      const gaps = cells.filter((cell) => cell.kind === 'empty').length;
      if (column.kind === 'number') {
        const values = numbers(cells);
        if (values.length === 0) return `- ${name} (число): значений нет.`;
        const unit = cells.find((cell) => cell.kind === 'number')?.unit ?? '';
        const least = values[0] ?? 0;
        const most = values[values.length - 1] ?? 0;
        const shown = (value: number) => figure(value) + (unit === '%' ? '%' : '');
        const sum = values.reduce((total, value) => total + value, 0);
        const distinct = new Map<number, number>();
        for (const value of values) distinct.set(value, (distinct.get(value) ?? 0) + 1);
        const tally =
          distinct.size <= FEW_NUMBERS
            ? ` Значения: ${[...distinct]
                .sort((a, b) => a[0] - b[0])
                .map(([value, count]) => `${shown(value)} — ${count}`)
                .join(', ')}.`
            : '';
        return (
          `- ${name} (число): значений ${values.length}, пропусков ${gaps}; ` +
          `минимум ${shown(least)}, первый квартиль ${shown(quantile(values, 0.25))}, ` +
          `медиана ${shown(quantile(values, 0.5))}, третий квартиль ${shown(quantile(values, 0.75))}, ` +
          `максимум ${shown(most)}; среднее ${shown(sum / values.length)}` +
          (unit === '%' ? '.' : `, сумма ${figure(sum)}.`) +
          tally
        );
      }
      if (column.kind === 'date') {
        const days = cells
          .map((cell) => (cell.kind === 'date' ? String(cell.value) : null))
          .filter((value): value is string => value !== null)
          .sort();
        return days.length === 0
          ? `- ${name} (дата): значений нет.`
          : `- ${name} (дата): с ${days[0]} по ${days[days.length - 1]}, пропусков ${gaps}.`;
      }
      const counts = new Map<string, number>();
      for (const cell of cells) {
        if (cell.kind === 'empty') continue;
        const text = cellText(cell, spreadsheet);
        counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
      const label = `- ${name} (${KIND[column.kind] ?? column.kind}): `;
      const filled = cells.length - gaps;
      if (ranked.length === filled && filled > LISTED_VALUES) {
        return label + `${filled} значений, все разные; пропусков ${gaps}.`;
      }
      if (ranked.length <= LISTED_VALUES) {
        return (
          label +
          `${ranked.length} ${plural(ranked.length, 'значение', 'значения', 'значений')}: ` +
          ranked.map(([text, count]) => `${text} — ${count}`).join(', ') +
          `; пропусков ${gaps}.`
        );
      }
      return (
        label +
        `${ranked.length} разных значений, пропусков ${gaps}; чаще всего: ` +
        ranked
          .slice(0, TOP_VALUES)
          .map(([text, count]) => `${text} — ${count}`)
          .join(', ') +
        '.'
      );
    })
    .join(NEWLINE);
}

function numbers(cells: readonly Cell[]): number[] {
  return cells
    .filter((cell) => cell.kind === 'number' && typeof cell.value === 'number')
    .map((cell) => cell.value as number)
    .sort((a, b) => a - b);
}

/**
 * Values far outside the middle half of their column (Tukey's far-out fences), farthest first:
 * a typo, a refund or the real story. Which one it is the brief cannot tell, so it only names them.
 */
function outlierNote(sheet: Sheet, rows: Sheet['rows']): string | null {
  const found: string[] = [];
  for (const [index, column] of sheet.columns.entries()) {
    if (column.kind !== 'number') continue;
    const cells = rows.map((row) => row.cells[index]).filter((cell) => cell !== undefined);
    const values = numbers(cells);
    if (values.length < OUTLIER_SAMPLE) continue;
    const low = quantile(values, 0.25);
    const high = quantile(values, 0.75);
    const spread = high - low;
    if (spread <= 0) continue;
    const distance = (value: number) => Math.max(low - value, value - high) / spread;
    const apart = cells
      .filter((cell) => typeof cell.value === 'number' && distance(cell.value) > OUTLIER_FENCE)
      .sort((a, b) => distance(b.value as number) - distance(a.value as number));
    if (apart.length === 0) continue;
    const shown = apart
      .slice(0, OUTLIERS_SHOWN)
      .map((cell) => `${cellText(cell, false)} (${cell.ref})`)
      .join(', ');
    found.push(`«${column.header ?? column.ref}»: ${shown} — всего ${apart.length}`);
  }
  return found.length > 0
    ? 'Выбросы, дальше трёх межквартильных размахов от квартилей, самые далёкие первыми: ' +
        `${found.join('; ')}.`
    : null;
}

function quantile(sorted: readonly number[], share: number): number {
  const position = (sorted.length - 1) * share;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const below = sorted[low] ?? 0;
  return below + ((sorted[high] ?? below) - below) * (position - low);
}

/** A computed figure: no grouping, a decimal comma, two places or four below one. */
function figure(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const places = Math.abs(value) < 1 ? 4 : 2;
  return String(Number(value.toFixed(places))).replace('.', ',');
}

/**
 * A cell as the file wrote it. A workbook stores machine numbers («0.46», «45678»), so its
 * numbers and dates are written from their values the way the sheet shows them.
 */
function cellText(cell: Cell, spreadsheet: boolean): string {
  if (cell.kind === 'empty') return 'нет данных';
  if (cell.kind === 'date' && /^\d+(\.\d+)?$/.test(cell.raw ?? '')) return String(cell.value);
  if (cell.kind === 'number' && spreadsheet && typeof cell.value === 'number') {
    const shown = String(Number(cell.value.toPrecision(15))).replace('.', ',');
    return cell.unit === '%' ? `${figure(cell.value)}%` : shown;
  }
  return clean(cell.raw ?? String(cell.value ?? ''));
}

function clean(text: string): string {
  return text
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join(NEWLINE);
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
