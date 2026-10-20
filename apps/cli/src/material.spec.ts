import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset, MaterialExtractResponse } from '@lct/contracts';
import { readMaterial, type MaterialEngine } from './material.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function file(name: string, contents: string | Buffer): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'cli-material-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, contents);
  return path;
}

function dataset(fileName: string, rows: [string, string][], status: Dataset['status'] = 'ok') {
  return {
    schemaVersion: 1,
    datasetId: 'dataset-test',
    status,
    source: { fileName, mediaType: 'text/csv', bytes: 1, sha256: 'a'.repeat(64) },
    sheets:
      status === 'failed'
        ? []
        : [
            {
              sheetId: 'sheet-1',
              name: 'Table 1',
              index: 0,
              state: 'visible',
              range: 'A1:B3',
              headerRow: 1,
              columns: [
                { columnId: 'sheet-1:A', index: 1, ref: 'A', header: 'Канал', kind: 'text' },
                { columnId: 'sheet-1:B', index: 2, ref: 'B', header: 'Доля', kind: 'number' },
              ],
              rows: rows.map(([channel, share], index) => ({
                row: index + 2,
                cells: [
                  { ref: `A${index + 2}`, raw: channel, kind: 'text', value: channel },
                  { ref: `B${index + 2}`, raw: share, kind: 'number', value: Number(share) },
                ],
              })),
            },
          ],
    diagnostics:
      status === 'failed' ? [{ code: 'no-table', severity: 'error', message: 'No table.' }] : [],
  } satisfies Dataset;
}

function engine(answer: Dataset, pages: MaterialExtractResponse[] = []) {
  const extractDataset = vi.fn(async () => answer);
  const extractMaterial = vi.fn(async () => {
    const page = pages.shift();
    if (!page) throw new Error('no more pages');
    return page;
  });
  return { engine: { extractDataset, extractMaterial } as MaterialEngine, extractDataset };
}

function page(text: string, nextOffset: number | null): MaterialExtractResponse {
  return {
    schemaVersion: 1,
    kind: 'text',
    sourceSha256: 'a'.repeat(64),
    segments: [{ index: 0, text, locator: { page: 1, paragraph: 1, sheet: null, range: null } }],
    table: null,
    offset: 0,
    nextOffset,
    truncated: false,
    needsOcr: false,
    warnings: [],
  };
}

describe('readMaterial', () => {
  it('reads a CSV as a typed table, the way the service writes it into a brief', async () => {
    const path = await file('shares.csv', 'Канал,Доля\nОнлайн,0.46\nРозница,0.31\n');
    const { engine: fake, extractDataset } = engine(
      dataset('shares.csv', [
        ['Онлайн', '0.46'],
        ['Розница', '0.31'],
      ]),
    );
    const text = await readMaterial(fake, path);
    expect(extractDataset).toHaveBeenCalledWith({ schemaVersion: 1, path });
    expect(text).toContain('Данные из файла «shares.csv».');
    expect(text).toContain('| Онлайн | 0.46 |');
  });

  it('refuses a data file that holds no table, with the reason', async () => {
    const path = await file('broken.json', '[{"a": 1');
    const { engine: fake } = engine(dataset('broken.json', [], 'failed'));
    await expect(readMaterial(fake, path)).rejects.toThrow(
      'Файл «broken.json» не читается как таблица: в файле нет таблицы.',
    );
  });

  it('keeps a text as it is and describes the tables found in it', async () => {
    const text = 'Итоги\n\n| Канал | Доля |\n|---|---|\n| Онлайн | 0.46 |\n';
    const path = await file('notes.md', text);
    const { engine: fake } = engine(dataset('notes.md', [['Онлайн', '0.46']]));
    const material = await readMaterial(fake, path);
    expect(material.startsWith(text.trimEnd())).toBe(true);
    expect(material).toContain('Таблицы в тексте файла «notes.md»: 1.');
  });

  it('keeps a text without a table exactly as it is', async () => {
    const path = await file('notes.txt', 'Просто текст.\n');
    const { engine: fake } = engine(dataset('notes.txt', [], 'failed'));
    expect(await readMaterial(fake, path)).toBe('Просто текст.\n');
  });

  it('reads a document page by page until the engine says it is done', async () => {
    const path = await file('brief.docx', 'docx bytes');
    const { engine: fake } = engine(dataset('brief.docx', [], 'failed'), [
      page('Первый абзац', 1),
      page('Второй абзац', null),
    ]);
    expect(await readMaterial(fake, path)).toBe('Первый абзац\nВторой абзац');
  });

  it('refuses a text that is not UTF-8 and a format it does not read', async () => {
    const { engine: fake, extractDataset } = engine(dataset('x', [], 'failed'));
    await expect(
      readMaterial(fake, await file('bad.txt', Buffer.from([0x61, 0xc3]))),
    ).rejects.toThrow(/UTF-8/);
    await expect(readMaterial(fake, await file('photo.png', 'png'))).rejects.toThrow(
      /не поддерживается/,
    );
    expect(extractDataset).not.toHaveBeenCalled();
  });
});
