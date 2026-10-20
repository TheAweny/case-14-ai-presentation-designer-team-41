import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { datasetSchema, type Dataset } from '@lct/contracts';
import {
  FULL_TABLE_CHARS,
  SAMPLE_ROWS,
  datasetRefusal,
  datasetText,
  embeddedTablesText,
} from './dataset-text.js';

/** Answers the engine gave for files of examples/datasets; an engine test keeps them current. */
function recorded(name: string): Dataset {
  const text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return datasetSchema.parse(JSON.parse(text));
}

type Sheet = Dataset['sheets'][number];

/** A small dataset written by hand for the cases the corpus does not pin down. */
function dataset(sheets: Sheet[], diagnostics: Dataset['diagnostics'] = []): Dataset {
  return {
    schemaVersion: 1,
    datasetId: 'dataset-test',
    status: 'ok',
    source: { fileName: 'test.csv', mediaType: 'text/csv', bytes: 1, sha256: 'a'.repeat(64) },
    sheets,
    diagnostics,
  };
}

function sheet(
  name: string,
  headers: string[],
  rows: (string | null)[][],
  kinds: Sheet['columns'][number]['kind'][],
): Sheet {
  return {
    sheetId: 'sheet-1',
    name,
    index: 0,
    state: 'visible',
    range: 'A1',
    headerRow: 1,
    columns: headers.map((header, index) => ({
      columnId: `sheet-1:${index}`,
      index: index + 1,
      ref: String.fromCharCode(65 + index),
      header,
      kind: kinds[index] ?? 'text',
    })),
    rows: rows.map((cells, index) => ({
      row: index + 2,
      cells: cells.map((raw, column) => {
        const kind = raw === null ? 'empty' : (kinds[column] ?? 'text');
        const value = raw === null ? null : kind === 'number' ? Number(raw.replace(',', '.')) : raw;
        return { ref: `${String.fromCharCode(65 + column)}${index + 2}`, raw, kind, value };
      }),
    })),
  };
}

describe('datasetText on the example corpus', () => {
  it('writes a small JSON table whole, with its figures as the file wrote them', () => {
    const text = datasetText(recorded('sales-channels.json'));
    expect(text).toContain('Данные из файла «sales-channels.json».');
    expect(text).toContain('Таблица: 4 строки, 2 столбца.');
    expect(text).toContain('Столбцы: channel — текст; share — число.');
    expect(text).toContain('| channel | share |');
    for (const row of ['| Онлайн | 0.46 |', '| Розница | 0.31 |', '| Прочее | 0.08 |'])
      expect(text).toContain(row);
  });

  it('keeps percent strings, decimal commas and gaps of a BI export, and says how it was read', () => {
    const text = datasetText(recorded('sales-channels-bi-export.json'));
    expect(text).toContain('| Онлайн | 46% | 1 012,4 | {"регионы":8} |');
    expect(text).toContain('| Партнёры | 15,5% | нет данных | ["опт","маркетплейсы"] |');
    expect(text).toContain('вложенные объекты или списки');
    expect(text).toContain('и через точку, и через запятую');
  });

  it('names the title above a 1C table, its encoding and its totals row', () => {
    const text = datasetText(recorded('revenue-monthly-1c-export.json'));
    expect(text).toContain('При чтении: файл не в UTF-8 и прочитан как Windows-1251.');
    expect(text).toContain('Над таблицей написано: «Выгрузка из 1С: Бухгалтерия');
    expect(text).toContain('| Дата | Выручка, тыс. руб. | Расходы, млн руб. | Комментарий |');
    expect(text).toContain('| 31.01.2024 | 115\u00a0600,0 | 75,4 | нет данных |');
    expect(text).toContain('Последняя строка «Итого» — итог по строкам выше');
  });

  it('summarises a long sheet over every row and shows its first rows, and says so', () => {
    const data = recorded('regions-report-messy.json');
    const text = datasetText(data);
    expect(text).toContain('Лист 4 «Справочник»: 300 строк, 6 столбцов.');
    expect(text).toContain('сводка по всем 300 строкам и первые 20 строк');
    expect(text).toMatch(/- price_rub \(число\): значений 300, пропусков 0; минимум [\d,]+/);
    expect(text).toMatch(/- category \(текст\): 3 значения: /);
    expect(text).toContain('- sku (текст): 300 значений, все разные; пропусков 0.');
    const reference = text.slice(text.indexOf('Лист 4 «Справочник»'));
    expect(reference.split('\n').filter((line) => line.startsWith('| SKU-')).length).toBe(
      SAMPLE_ROWS,
    );
    expect(text).toContain('Лист 2 «служебный» (скрытый лист)');
    expect(text).toContain('Лист 3 «пустой»: лист пуст.');
    expect(text).toContain('| Москва | 350,3 | 401,9 | 114,73% | 2025-12-20 | нет данных |');
  });

  it('writes every number of a whole table so that it can be found in the brief', () => {
    for (const name of [
      'sales-channels.json',
      'sales-channels-bi-export.json',
      'revenue-monthly-1c-export.json',
    ]) {
      const data = recorded(name);
      const text = datasetText(data);
      for (const item of data.sheets)
        for (const row of item.rows)
          for (const cell of row.cells)
            if (cell.kind === 'number' && cell.raw)
              expect(text, `${name} ${cell.ref}`).toContain(cell.raw.replace(/\s*\n\s*/g, ' '));
    }
  });

  it('summarises 400 hand-kept checks, their gaps, their refunds and their typo', () => {
    const text = datasetText(recorded('order-checks-dirty.json'));
    expect(text.length).toBeLessThan(FULL_TABLE_CHARS);
    expect(text).toContain('сводка по всем 400 строкам и первые 20 строк');
    expect(text).toMatch(/- Чек \(число\): значений 397, пропусков 3; минимум -\d+/);
    expect(text).toContain('максимум 9999999;');
    expect(text).toContain('- Номер заказа (текст): 400 значений, все разные; пропусков 0.');
    expect(text).toContain('возврат — 5, опечатка оператора, проверить — 1');
    expect(text).toContain('Выбросы, дальше трёх межквартильных размахов от квартилей');
    expect(text).toMatch(/«Чек»: 9 999 999 \(B252\), [^;]+ — всего \d+;/);
  });

  it('names no outlier where the values are of one scale', () => {
    expect(datasetText(recorded('revenue-monthly-1c-export.json'))).not.toContain('Выбросы');
  });

  it('says what the tables inside a pasted text are, without repeating their rows', () => {
    const text = embeddedTablesText(recorded('quarter-report-pasted.json'));
    expect(text).toContain('Таблицы в тексте файла «quarter-report-pasted.txt»: 2.');
    expect(text).toContain(
      'Таблица 1: 3 строки, столбцы: Команда — текст; Задачи — число; Закрыто — число. ' +
        'При чтении: пропуски записаны словами («н/д»); это пропуски, а не нули.',
    );
    expect(text).toContain(
      'Таблица 2: 3 строки, столбцы: Месяц — текст; Выручка, млн ₽ — число; Клиенты — число.',
    );
    expect(text).not.toContain('Альфа');
  });

  it('explains why a broken file is no table', () => {
    expect(datasetRefusal(recorded('truncated.json'))).toBe('файл повреждён или это не таблица');
  });
});

describe('datasetText summaries', () => {
  const long = (rows: (string | null)[][]) =>
    sheet('Продажи', ['Регион', 'Сумма'], rows, ['text', 'number']);

  it('leaves the totals row out of the summary and gaps out of the figures', () => {
    const rows: (string | null)[][] = [];
    for (let index = 1; index <= 1500; index += 1)
      rows.push([`Город ${index}`, index % 100 === 0 ? null : String(index)]);
    rows.push(['Итого', '9999999']);
    const text = datasetText(
      dataset(
        [long(rows)],
        [
          {
            code: 'total-row',
            severity: 'info',
            message: 'total',
            sheet: 'Продажи',
            ref: `A${rows.length + 1}`,
          },
        ],
      ),
    );
    expect(text).toContain('сводка по всем 1500 строкам');
    expect(text).toContain('- Сумма (число): значений 1485, пропусков 15; минимум 1,');
    expect(text).toContain('максимум 1499;');
    expect(text).not.toContain('9999999;');
    expect(text).toContain('Последняя строка «Итого» — итог по строкам выше');
  });

  it('computes quartiles over the sorted values', () => {
    const rows = Array.from({ length: 2000 }, (_, index) => [`r${index}`, String(index + 1)]);
    const text = datasetText(dataset([long(rows)]));
    expect(text).toContain(
      'минимум 1, первый квартиль 500,75, медиана 1000,5, третий квартиль 1500,25, ' +
        'максимум 2000; среднее 1000,5, сумма 2001000.',
    );
  });

  it('writes a short table whole, with no summary', () => {
    const text = datasetText(
      dataset([
        long([
          ['Москва', '10'],
          ['Казань', null],
        ]),
      ]),
    );
    expect(text).toContain('| Москва | 10 |\n| Казань | нет данных |');
    expect(text).not.toContain('сводка');
  });

  it('keeps a pipe or a line break inside a cell from breaking the table', () => {
    const text = datasetText(
      dataset([sheet('Заметки', ['Тема', 'Текст'], [['a|b', 'первая\nвторая']], ['text', 'text'])]),
    );
    expect(text).toContain('| a\\|b | первая вторая |');
  });
});
