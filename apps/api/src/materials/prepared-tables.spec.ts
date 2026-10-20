import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { datasetSchema, type Dataset } from '@lct/contracts';
import { readPreparedMaterial, type MaterialExtractEngine } from './prepared-material.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function stored(name: string, contents: string | Buffer) {
  const folder = await mkdtemp(join(tmpdir(), 'prepared-tables-'));
  folders.push(folder);
  const path = join(folder, name);
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
  await writeFile(path, bytes);
  return {
    sourceId: crypto.randomUUID(),
    name,
    path,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function recorded(name: string, sha256: string): Promise<Dataset> {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  const dataset = datasetSchema.parse(JSON.parse(text));
  return { ...dataset, source: { ...dataset.source, sha256 } };
}

function engineWith(dataset: (path: string) => Promise<Dataset>) {
  const extractMaterial = vi.fn(async () => {
    throw new Error('a data file is never read as text pages');
  });
  const extractDataset = vi.fn(async (request: { path: string }) => dataset(request.path));
  const engine: MaterialExtractEngine = { extractMaterial, extractDataset };
  return { engine, extractMaterial, extractDataset };
}

describe('data files in a brief', () => {
  it.each([
    ['sales-channels.json', 'sales-channels.json', '| Онлайн | 0.46 |'],
    ['revenue.csv', 'revenue-monthly-1c-export.json', 'Над таблицей написано'],
    ['checks.tsv', 'order-checks-dirty.json', '| Б-0 | ₽1 642 | 1642 |'],
    ['report.xlsx', 'regions-report-messy.json', 'Лист 4 «Справочник»'],
  ])('reads %s as a typed table', async (name, fixture, expected) => {
    const file = await stored(name, `bytes of ${name}`);
    const { engine, extractMaterial, extractDataset } = engineWith(() =>
      recorded(fixture, file.hash),
    );
    const prepared = await readPreparedMaterial(engine, file);
    expect(prepared.text).toContain(expected);
    expect(prepared.sourceSha256).toBe(file.hash);
    expect(extractDataset).toHaveBeenCalledWith({ schemaVersion: 1, path: file.path }, undefined);
    expect(extractMaterial).not.toHaveBeenCalled();
  });

  it('refuses a broken data file with the reason in words, not an empty brief', async () => {
    const file = await stored('channels.json', '[{"channel": "Онлайн", "share": 0.46}, {"chan');
    const { engine } = engineWith(() => recorded('truncated.json', file.hash));
    const failure = readPreparedMaterial(engine, file);
    await expect(failure).rejects.toBeInstanceOf(BadRequestException);
    await expect(failure).rejects.toThrow(
      'Файл «channels.json» не читается как таблица: файл повреждён или это не таблица.',
    );
  });

  it('refuses an answer about other bytes than the stored file', async () => {
    const file = await stored('channels.json', '[]');
    const { engine } = engineWith(() => recorded('sales-channels.json', 'c'.repeat(64)));
    await expect(readPreparedMaterial(engine, file)).rejects.toThrow(/hash does not match/);
  });

  it('reuses the prepared table and asks the engine once', async () => {
    const file = await stored('sales-channels.json', '[{"channel":"Онлайн","share":0.46}]');
    const { engine, extractDataset } = engineWith(() => recorded('sales-channels.json', file.hash));
    const first = await readPreparedMaterial(engine, file);
    const second = await readPreparedMaterial(engine, file);
    expect(second).toEqual(first);
    expect(extractDataset).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation to the engine', async () => {
    const file = await stored('sales-channels.json', '[]');
    const controller = new AbortController();
    const { engine } = engineWith(async () => {
      controller.abort(new Error('person cancelled'));
      return recorded('sales-channels.json', file.hash);
    });
    await expect(readPreparedMaterial(engine, file, controller.signal)).rejects.toThrow(
      'person cancelled',
    );
  });
});

describe('text files with tables inside', () => {
  it('keeps every word of the text and describes the tables after it', async () => {
    const text = 'Привет! Скидываю цифры\n\nКоманда | Задачи\n:--- | ---:\nАльфа | 40\n\n';
    const file = await stored('quarter-report-pasted.txt', text);
    const { engine } = engineWith(() => recorded('quarter-report-pasted.json', file.hash));
    const prepared = await readPreparedMaterial(engine, file);
    expect(prepared.text.startsWith(text.trimEnd())).toBe(true);
    expect(prepared.text).toContain('Таблицы в тексте файла «quarter-report-pasted.txt»: 2.');
  });

  it('keeps a text without a table exactly as it is', async () => {
    const text = '﻿Заметки без цифр.\n';
    const file = await stored('notes.md', text);
    const { engine } = engineWith(async () => ({
      ...(await recorded('truncated.json', file.hash)),
      diagnostics: [{ code: 'no-table', severity: 'error', message: 'no table' }],
    }));
    const prepared = await readPreparedMaterial(engine, file);
    expect(prepared.text).toBe(text);
  });

  it('rejects text that is not UTF-8 before asking the engine', async () => {
    const file = await stored('broken.txt', Buffer.from([0x61, 0xc3]));
    const { engine, extractDataset } = engineWith(() => recorded('truncated.json', file.hash));
    await expect(readPreparedMaterial(engine, file)).rejects.toThrow(/UTF-8/);
    expect(extractDataset).not.toHaveBeenCalled();
  });
});
