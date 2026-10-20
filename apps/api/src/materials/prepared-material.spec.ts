import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dataset, MaterialExtractResponse } from '@lct/contracts';
import { readPreparedMaterial, type MaterialExtractEngine } from './prepared-material.js';

const folders: string[] = [];
/** Text pages never ask for tables: a call here is a wrong route. */
const noDataset = vi.fn(async () => {
  throw new Error('dataset extraction was not expected');
});

afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function source(name: string, bytes: Buffer = Buffer.from('saved source bytes')) {
  const folder = await mkdtemp(join(tmpdir(), 'prepared-own-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, bytes);
  return {
    folder,
    sourceId: crypto.randomUUID(),
    name,
    path,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

function page(
  hash: string,
  text: string,
  extra: Partial<MaterialExtractResponse> = {},
): MaterialExtractResponse {
  return {
    schemaVersion: 1,
    kind: 'text',
    sourceSha256: hash,
    segments: [
      {
        index: 0,
        text,
        locator: { page: 1, paragraph: 1, sheet: null, range: null },
      },
    ],
    table: null,
    offset: extra.offset ?? 0,
    nextOffset: null,
    truncated: false,
    needsOcr: false,
    warnings: [],
    ...extra,
  };
}

describe('prepared material cache and failure cases', () => {
  it('caches labels and typed cells together, and invalidates on changed brief/model/prompt key', async () => {
    const file = await source('facts.csv', Buffer.from('group,value\na,10\nb,20'));
    const dataset: Dataset = {
      datasetId: 'facts',
      status: 'ok',
      diagnostics: [],
      source: { fileName: file.name, sha256: file.hash, bytes: 28, mediaType: 'text/csv' },
      sheets: [
        {
          sheetId: 's',
          name: 'Facts',
          index: 0,
          range: 'A1:B3',
          headerRow: 1,
          columns: [
            { columnId: 'a', index: 1, ref: 'A', header: 'group', kind: 'text' },
            { columnId: 'b', index: 2, ref: 'B', header: 'value', kind: 'number' },
          ],
          rows: [
            {
              row: 2,
              cells: [
                { ref: 'A2', raw: 'a', kind: 'text', value: 'a' },
                { ref: 'B2', raw: '10', kind: 'number', value: 10 },
              ],
            },
          ],
        },
      ],
    };
    const extractDataset = vi.fn(async () => dataset);
    const engine = { extractDataset, extractMaterial: vi.fn() };
    const callback = vi.fn(async () => ({
      rowsLabel: 'Число строк',
      columns: [{ column: '["s","b"]', label: 'Значение', values: [] }],
    }));
    const labeler = Object.assign(callback, { cacheKey: 'brief-model-prompt-v1' });
    const first = await readPreparedMaterial(engine, file, undefined, labeler);
    const second = await readPreparedMaterial(engine, file, undefined, labeler);
    expect(second).toEqual(first);
    expect(second.dataset?.sheets[0]?.rows[0]?.cells[1]?.value).toBe(10);
    expect(first.text).toContain('Значение (value)');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(extractDataset).toHaveBeenCalledTimes(1);
    await readPreparedMaterial(
      engine,
      file,
      undefined,
      Object.assign(callback, { cacheKey: 'brief-model-prompt-v2' }),
    );
    expect(callback).toHaveBeenCalledTimes(2);
    expect(extractDataset).toHaveBeenCalledTimes(2);
  });

  it('keeps the source columns if a labeler throws, and still honours Stop', async () => {
    const file = await source('facts.csv');
    const dataset: Dataset = {
      datasetId: 'facts',
      status: 'ok',
      diagnostics: [],
      sheets: [],
      source: { fileName: file.name, sha256: file.hash, bytes: 1, mediaType: 'text/csv' },
    };
    const engine = { extractDataset: vi.fn(async () => dataset), extractMaterial: vi.fn() };
    const labeler = vi.fn(async () => {
      throw new Error('Provider unavailable');
    });
    const material = await readPreparedMaterial(engine, file, undefined, labeler);
    expect(material.text).toContain('Данные из файла');
    expect(material.dataset).toMatchObject(dataset);
    const controller = new AbortController();
    const stopped = async () => {
      controller.abort(new DOMException('Stop', 'AbortError'));
      return null;
    };
    await expect(
      readPreparedMaterial(engine, file, controller.signal, stopped),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reuses a valid disk cache and does not call the engine again', async () => {
    const file = await source('notes.pdf', Buffer.from('pdf bytes'));
    const extractMaterial = vi.fn(async () => page(file.hash, 'First reading'));
    const engine: MaterialExtractEngine = { extractMaterial, extractDataset: noDataset };
    const first = await readPreparedMaterial(engine, file);
    const second = await readPreparedMaterial(engine, file);
    expect(first.text).toBe('First reading');
    expect(second).toEqual(first);
    expect(extractMaterial).toHaveBeenCalledTimes(1);
    const record = JSON.parse(
      await readFile(join(file.folder, 'material-prepared.json'), 'utf8'),
    ) as {
      preparationRevision: string;
      extension: string;
      sourceSha256: string;
    };
    expect(record.preparationRevision).toBe('2026-10-20.4');
    expect(record.extension).toBe('.pdf');
    expect(record.sourceSha256).toBe(file.hash);
  });

  it('extracts again when the cached text hash was forged', async () => {
    const file = await source('notes.pdf', Buffer.from('pdf bytes'));
    const extractMaterial = vi.fn(async () => page(file.hash, 'Trusted text'));
    await readPreparedMaterial({ extractMaterial, extractDataset: noDataset }, file);
    const recordPath = join(file.folder, 'material-prepared.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as { textSha256: string };
    record.textSha256 = 'a'.repeat(64);
    await writeFile(recordPath, JSON.stringify(record));
    await writeFile(join(file.folder, 'material-prepared.txt'), 'Forged text');
    const prepared = await readPreparedMaterial(
      { extractMaterial, extractDataset: noDataset },
      file,
    );
    expect(prepared.text).toBe('Trusted text');
    expect(extractMaterial).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when the source bytes change', async () => {
    const file = await source('notes.pdf', Buffer.from('pdf bytes'));
    const extractMaterial = vi.fn(async () => page(file.hash, 'Old bytes'));
    await readPreparedMaterial({ extractMaterial, extractDataset: noDataset }, file);
    const nextBytes = Buffer.from('pdf bytes changed');
    await writeFile(file.path, nextBytes);
    const nextHash = createHash('sha256').update(nextBytes).digest('hex');
    extractMaterial.mockImplementation(async () => page(nextHash, 'New bytes'));
    const prepared = await readPreparedMaterial(
      { extractMaterial, extractDataset: noDataset },
      file,
    );
    expect(prepared.text).toBe('New bytes');
    expect(prepared.sourceSha256).toBe(nextHash);
    expect(extractMaterial).toHaveBeenCalledTimes(2);
  });

  it('rejects a page over 60000 characters before asking for the next one, and rejects OCR', async () => {
    const long = await source('long.docx', Buffer.from('docx'));
    const extractMaterial = vi.fn(async () =>
      page(long.hash, 'x'.repeat(60_001), { nextOffset: 1, truncated: true }),
    );
    await expect(
      readPreparedMaterial({ extractMaterial, extractDataset: noDataset }, long),
    ).rejects.toThrow(/60000/);
    expect(extractMaterial).toHaveBeenCalledTimes(1);

    const scan = await source('scan.pdf', Buffer.from('scan'));
    const ocr = vi.fn(async () => page(scan.hash, '', { needsOcr: true }));
    await expect(
      readPreparedMaterial({ extractMaterial: ocr, extractDataset: noDataset }, scan),
    ).rejects.toThrow(/OCR/);
    expect(ocr).toHaveBeenCalledTimes(1);
  });
});
