import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { datasetSchema, type Dataset, type MaterialExtractResponse } from '@lct/contracts';
import { readPreparedMaterial, type MaterialExtractEngine } from './prepared-material.js';

const folders: string[] = [];
/** Text pages never ask for tables: a call here is a wrong route. */
const noDataset = vi.fn(async () => {
  throw new Error('dataset extraction was not expected');
});
async function fixture(name: string): Promise<Dataset> {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return datasetSchema.parse(JSON.parse(text));
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function source(name: string, bytes = Buffer.from('saved source bytes')) {
  const folder = await mkdtemp(join(tmpdir(), 'prepared-acceptance-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, bytes);
  return {
    sourceId: crypto.randomUUID(),
    name,
    path,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}
const segment = (
  text: string,
  index: number,
  sheet: string | null = null,
  range: string | null = null,
) => ({
  index,
  text,
  locator: { page: null, paragraph: sheet === null ? 1 : null, sheet, range },
});
function page(
  hash: string,
  segments: MaterialExtractResponse['segments'],
  extra: Partial<MaterialExtractResponse> = {},
): MaterialExtractResponse {
  return {
    schemaVersion: 1,
    kind: 'text',
    sourceSha256: hash,
    segments,
    table: null,
    offset: 0,
    nextOffset: null,
    truncated: false,
    needsOcr: false,
    warnings: [],
    ...extra,
  };
}

describe('independent material preparation acceptance', () => {
  it('reads every sheet of an XLSX as a typed table, hidden and empty ones included', async () => {
    const recorded = await fixture('regions-report-messy.json');
    const file = await source('regions-report-messy.xlsx');
    const extractMaterial = vi.fn();
    const extractDataset = vi.fn(async (request: { path: string }) => {
      expect(request.path).toBe(file.path);
      return { ...recorded, source: { ...recorded.source, sha256: file.hash } };
    });
    const prepared = await readPreparedMaterial({ extractMaterial, extractDataset }, file);
    for (const value of [
      'Лист 1 «Отчёт 2025 📊»',
      'Лист 2 «служебный» (скрытый лист)',
      'Лист 3 «пустой»',
      'Лист 4 «Справочник»',
      '| Регион | План | Факт | Выполнение | Обновлено | Комментарий |',
      'Над таблицей написано: «Продажи по регионам, 2025 год (млн ₽)».',
    ])
      expect(prepared.text).toContain(value);
    expect(extractMaterial).not.toHaveBeenCalled();
  });

  it('joins a paragraph across engine pages without breaking its number', async () => {
    const file = await source('split.docx');
    const extractMaterial = vi.fn(async (request: { offset?: number }) =>
      request.offset === 0
        ? page(file.hash, [segment('Budget 2', 0)], { truncated: true, nextOffset: 1 })
        : page(file.hash, [segment('5 млн', 1)], { offset: 1 }),
    );
    const prepared = await readPreparedMaterial(
      { extractMaterial, extractDataset: noDataset },
      file,
    );
    expect(prepared.text).toBe('Budget 25 млн');
    expect(extractMaterial).toHaveBeenCalledTimes(2);
  });

  it('rejects a partial terminal page and a mismatching source hash', async () => {
    const file = await source('partial.pdf');
    await expect(
      readPreparedMaterial(
        {
          extractMaterial: async () =>
            page(file.hash, [segment('Only beginning', 0)], { truncated: true }),
          extractDataset: noDataset,
        },
        file,
      ),
    ).rejects.toThrow();
    await expect(
      readPreparedMaterial(
        {
          extractMaterial: async () => page('b'.repeat(64), [segment('Wrong file', 0)]),
          extractDataset: noDataset,
        },
        file,
      ),
    ).rejects.toThrow();
  });

  it('honors cancellation before opening storage and rejects invalid UTF-8', async () => {
    const engine: MaterialExtractEngine = { extractMaterial: vi.fn(), extractDataset: vi.fn() };
    const controller = new AbortController();
    controller.abort(new Error('acceptance cancelled'));
    await expect(
      readPreparedMaterial(
        engine,
        { sourceId: 'id', name: 'absent.txt', path: '/absent/material.txt' },
        controller.signal,
      ),
    ).rejects.toThrow('acceptance cancelled');
    const file = await source('invalid.txt', Buffer.from([0x61, 0xc3]));
    await expect(readPreparedMaterial(engine, file)).rejects.toThrow();
    expect(engine.extractMaterial).not.toHaveBeenCalled();
    expect(engine.extractDataset).not.toHaveBeenCalled();
  });
});
