import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialExtractResponse } from '@lct/contracts';
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
    expect(record.preparationRevision).toBe('2026-10-20.2');
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
