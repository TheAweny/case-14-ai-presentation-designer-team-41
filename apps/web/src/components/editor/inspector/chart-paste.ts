import type { ChartData } from '@/components/editor/inspector/chart-data';

/**
 * Данные графика из буфера обмена: диапазон, скопированный из Excel, Google Таблиц или
 * LibreOffice (TSV), либо CSV-текст. Всё здесь — чистые функции: панель только читает буфер.
 */

/** Разделитель столбцов: табуляция у таблиц, точка с запятой у CSV русского Excel, иначе запятая. */
function delimiterOf(text: string): string {
  if (text.includes('\t')) return '\t';
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  if (firstLine.includes(';')) return ';';
  return ',';
}

/**
 * Строки и ячейки текста. Кавычки — как в CSV и в TSV Excel: ячейка в кавычках может содержать
 * разделитель и перенос строки, `""` внутри — одна кавычка. Пустые строки в конце (Excel
 * заканчивает диапазон переводом строки) отбрасываются.
 */
export function parseDelimited(text: string): string[][] {
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = '';
      atCellStart = true;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atCellStart = true;
      continue;
    }
    cell += char;
    atCellStart = false;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length > 0 && rows.at(-1)?.every((value) => value.trim() === '')) rows.pop();
  return rows;
}

/** Больше одной ячейки: такую вставку разбирает таблица, а не поле. */
export function isRange(text: string): boolean {
  return /[\t\r\n]/.test(text.replace(/[\r\n]+$/, ''));
}

/** Знак валюты перед числом и валюта или процент после него: их таблица пишет в ячейку. */
const CURRENCY_BEFORE = /^[$€£¥₽]/;
const UNIT_AFTER = /(%|‰|[$€£¥₽]|руб\.?|р\.)$/i;

/**
 * Число, как его пишут в таблицах: «1 234,5» (пробел, неразрывный или узкий пробел между
 * разрядами), «1.234,5», «1,234.5», «−7», «12 %», «₽ 300». Из двух знаков — запятой и точки —
 * дробную часть отделяет последний; одна запятая — десятичная, как в русской локали; повторённый
 * знак — разделитель разрядов. Скобки бухгалтерии — минус. Мусор даёт null.
 */
export function parseLocaleNumber(text: string): number | null {
  let value = text.trim().replace(/[\s\u00a0\u202f\u2009']/g, '');
  if (value === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/^[−–]/, '-');
  // Валюта и проценты по краям числа.
  value = value.replace(CURRENCY_BEFORE, '').replace(UNIT_AFTER, '');
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const group = decimal === ',' ? '.' : ',';
    value = value.replaceAll(group, '').replace(decimal, '.');
  } else if (lastComma >= 0) {
    value = value.split(',').length > 2 ? value.replaceAll(',', '') : value.replace(',', '.');
  } else if (lastDot >= 0 && value.split('.').length > 2) {
    value = value.replaceAll('.', '');
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return negative ? -number : number;
}

/** Год в ячейке: четыре цифры, с 1000 по 2999. */
const YEAR = /^[12]\d{3}$/;

/** Непустая ячейка, которая не читается как число: подпись, а не значение. */
function isLabel(cell: string | undefined): boolean {
  return cell !== undefined && cell.trim() !== '' && parseLocaleNumber(cell) === null;
}

/**
 * Есть ли у диапазона строка заголовка. Подпись среди ячеек первой строки — есть. Годы
 * в заголовке — числа, но тогда угол над подписями категорий пуст, как в Excel.
 */
function hasHeaderRow(rows: readonly (readonly string[])[], width: number): boolean {
  const [header = [], ...body] = rows;
  if (body.length === 0) return false;
  if (width === 1) return isLabel(header[0]);
  if (header.slice(1).some(isLabel)) return true;
  return (header[0] ?? '').trim() === '' && body.some((row) => isLabel(row[0]));
}

/** Имена по умолчанию для рядов и категорий, которых в диапазоне нет. */
export interface ChartNames {
  series(n: number): string;
  category(n: number): string;
}

/**
 * Весь график из диапазона: первая строка — имена рядов, первый столбец — категории, как
 * в таблице данных PowerPoint. Если в первой строке одни числа, заголовка нет и ряды получают
 * имена по умолчанию; если числа в первом столбце — это не подписи, а значения. Пустая или
 * нечисловая ячейка значения — 0. Диапазон без единого числа — не данные: null.
 */
export function chartDataFromRows(
  rows: readonly (readonly string[])[],
  names: ChartNames,
): ChartData | null {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || width === 0) return null;
  const header = rows[0] ?? [];
  const hasHeader = hasHeaderRow(rows, width);
  const body = hasHeader ? rows.slice(1) : rows;
  // Пустой угол над первым столбцом — знак, что в столбце подписи, даже если это числа.
  // Столбец годов под заголовком («Год») — тоже подписи, а не ряд значений.
  const emptyCorner = hasHeader && (header[0] ?? '').trim() === '';
  const years = hasHeader && body.every((row) => YEAR.test((row[0] ?? '').trim()));
  const hasLabels = width > 1 && (emptyCorner || years || body.some((row) => isLabel(row[0])));
  const firstValue = hasLabels ? 1 : 0;
  const seriesCount = width - firstValue;
  if (seriesCount <= 0) return null;
  let found = false;
  const series = Array.from({ length: seriesCount }, (_, s) => {
    const column = firstValue + s;
    const title = hasHeader ? (header[column] ?? '').trim() : '';
    const values = body.map((row) => {
      const value = parseLocaleNumber(row[column] ?? '');
      if (value === null) return 0;
      found = true;
      return value;
    });
    return { name: title || names.series(s + 1), values };
  });
  if (!found) return null;
  const categories = body.map((row, c) => {
    const label = hasLabels ? (row[0] ?? '').trim() : '';
    return label || names.category(c + 1);
  });
  return { categories, series };
}

/** Ячейка сетки данных: строка 0 — имена рядов, столбец 0 — категории. */
export interface ChartCell {
  readonly row: number;
  readonly column: number;
}

/**
 * Диапазон, вставленный в ячейку, ложится от неё вправо и вниз, как в Excel. Не хватает
 * категорий или рядов — добавляются новые (значения 0, имена по умолчанию). Ячейку, которую
 * не удалось прочесть как число, вставка обходит: прежнее значение остаётся.
 */
export function pasteRows(
  data: ChartData,
  rows: readonly (readonly string[])[],
  at: ChartCell,
  names: ChartNames,
): ChartData {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const lastRow = at.row + rows.length - 1;
  const lastColumn = at.column + width - 1;
  const categoryCount = Math.max(data.categories.length, lastRow);
  const seriesCount = Math.max(data.series.length, lastColumn);
  const categories = Array.from(
    { length: categoryCount },
    (_, c) => data.categories[c] ?? names.category(c + 1),
  );
  const series = Array.from({ length: seriesCount }, (_, s) => {
    const existing = data.series[s];
    return {
      name: existing?.name ?? names.series(s + 1),
      values: Array.from({ length: categoryCount }, (_, c) => existing?.values[c] ?? 0),
    };
  });
  for (const [r, row] of rows.entries()) {
    for (const [c, raw] of row.entries()) {
      const gridRow = at.row + r;
      const gridColumn = at.column + c;
      const text = raw.trim();
      if (gridRow === 0 && gridColumn === 0) continue;
      if (gridRow === 0) {
        const target = series[gridColumn - 1];
        if (target && text) target.name = text;
      } else if (gridColumn === 0) {
        if (text) categories[gridRow - 1] = text;
      } else {
        const value = parseLocaleNumber(text);
        const target = series[gridColumn - 1];
        if (target && value !== null) target.values[gridRow - 1] = value;
      }
    }
  }
  return { categories, series };
}
