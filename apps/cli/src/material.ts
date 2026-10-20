import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Dataset, MaterialExtractResponse } from '@lct/contracts';
import { datasetRefusal, datasetText, embeddedTablesText } from '@lct/pipeline';

/** The engine calls a config run needs to read its content. */
export interface MaterialEngine {
  extractDataset(request: { schemaVersion: 1; path: string }): Promise<Dataset>;
  extractMaterial(request: {
    schemaVersion: 1;
    path: string;
    format: 'text';
    offset?: number;
    limit?: number;
  }): Promise<MaterialExtractResponse>;
}

/** Text a person wrote: copied as it is, with the tables found inside it described after it. */
const TEXT = new Set(['.txt', '.md', '.yaml', '.yml']);
/** Files that are tables: read as typed tables, never as raw text. */
const TABLES = new Set(['.csv', '.tsv', '.xlsx', '.json']);
/** Documents the engine reads into text pages. */
const DOCUMENTS = new Set(['.docx', '.pdf']);
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

/**
 * The content of a config run as the service prepares it for a brief: a table is written whole
 * or summarised over all of its rows, a text keeps every word, a document is read page by page.
 */
export async function readMaterial(engine: MaterialEngine, path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  const name = basename(path);
  if (TABLES.has(extension)) {
    const dataset = await engine.extractDataset({ schemaVersion: 1, path });
    if (dataset.status === 'failed') {
      throw new Error(`Файл «${name}» не читается как таблица: ${datasetRefusal(dataset)}.`);
    }
    return datasetText(dataset);
  }
  if (TEXT.has(extension)) {
    const text = await readUtf8(path, name);
    const dataset = await engine.extractDataset({ schemaVersion: 1, path });
    if (dataset.status === 'failed' || dataset.sheets.length === 0) return text;
    return `${text.trimEnd()}\n\n${embeddedTablesText(dataset)}`;
  }
  if (DOCUMENTS.has(extension)) return readDocument(engine, path, name);
  throw new Error(
    `Материал «${name}» не поддерживается: подойдут .txt, .md, .yaml, .docx, .pdf, .csv, .tsv, .xlsx, .json.`,
  );
}

async function readUtf8(path: string, name: string): Promise<string> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch {
    throw new Error(`Материал «${name}» не в кодировке UTF-8.`);
  }
}

async function readDocument(engine: MaterialEngine, path: string, name: string): Promise<string> {
  const parts: string[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await engine.extractMaterial({
      schemaVersion: 1,
      path,
      format: 'text',
      offset,
      limit: PAGE_LIMIT,
    });
    if (response.needsOcr) throw new Error(`В «${name}» нет текстового слоя: нужен OCR.`);
    parts.push(...response.segments.map((segment) => segment.text));
    if (response.nextOffset === null) {
      if (response.truncated) throw new Error(`«${name}» прочитан не до конца.`);
      return parts.join('\n');
    }
    if (response.nextOffset <= offset) throw new Error(`Чтение «${name}» не продвигается.`);
    offset = response.nextOffset;
  }
  throw new Error(`«${name}» длиннее, чем читается за один запуск.`);
}

/**
 * The typed tables of the content for the writer: a chart or a figure on a slide is then taken
 * from cells it can cite, never retyped from the brief. A file with no table gives none.
 */
export async function datasetsOf(engine: MaterialEngine, path: string): Promise<Dataset[]> {
  const extension = extname(path).toLowerCase();
  if (!TABLES.has(extension) && !TEXT.has(extension)) return [];
  const dataset = await engine.extractDataset({ schemaVersion: 1, path });
  return dataset.status === 'failed' || dataset.sheets.length === 0 ? [] : [dataset];
}
