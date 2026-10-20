import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import type { Dataset, MaterialExtractResponse } from '@lct/contracts';
import { datasetRefusal, datasetText, embeddedTablesText } from './dataset-text.js';

/** A stored content file the account is already allowed to use. */
export interface PreparedMaterialSource {
  readonly sourceId: string;
  readonly name: string;
  readonly path: string;
}

/** Text of one material, ready to append to a brief. */
export interface PreparedMaterial {
  readonly sourceSha256: string;
  readonly text: string;
}

/** The engine call this helper needs. Generation passes its EngineClient. */
export interface MaterialExtractEngine {
  extractMaterial(
    request: {
      schemaVersion: 1;
      path: string;
      format: 'text';
      offset?: number;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<MaterialExtractResponse>;
  extractDataset(
    request: { schemaVersion: 1; path: string },
    signal?: AbortSignal,
  ): Promise<Dataset>;
}

/** Text a person wrote: copied exactly, with the tables found inside it described after it. */
const RAW_TEXT = new Set(['.txt', '.md']);
/** Files that are tables: read as typed tables, never as a stream of cells. */
const DATA_FILES = new Set(['.csv', '.tsv', '.xlsx', '.json']);
const EXTRACTED_TEXT = new Set(['.docx', '.pdf']);

/** The engine page size. The contract refuses a larger limit. */
const PAGE_LIMIT = 100;
/** Stop rather than follow an extraction that never finishes. */
const MAX_PAGES = 100;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_CHARS = 60_000;
const READ_CHUNK = 65_536;
const NEWLINE = String.fromCharCode(10);

const CACHE_JSON = 'material-prepared.json';
const CACHE_TEXT = 'material-prepared.txt';

/**
 * Bump when the canonical text changes. A cache without this revision is ignored:
 * an older reader copied CSV as it was and gave a workbook as a stream of cells.
 */
const PREPARATION_REVISION = '2026-10-20.1';

interface PreparedCache {
  readonly schemaVersion: 1;
  readonly preparationRevision: typeof PREPARATION_REVISION;
  readonly extension: string;
  readonly sourceSha256: string;
  readonly textSha256: string;
}

type Segment = MaterialExtractResponse['segments'][number];

interface BuiltText {
  text: string;
  previous: string | undefined;
}

/**
 * Read a content file for a brief.
 *
 * Plain text and Markdown are copied exactly, including a leading BOM, and the tables found in
 * them are described after the text. CSV, TSV, XLSX and JSON are read by the engine as typed
 * tables: every sheet, a short table whole and a long one summarised over all of its rows.
 * DOCX and PDF are read from the engine as text pages. The result is never silently shortened.
 */
export async function readPreparedMaterial(
  engine: MaterialExtractEngine,
  source: PreparedMaterialSource,
  signal?: AbortSignal,
): Promise<PreparedMaterial> {
  signal?.throwIfAborted();
  const extension = extname(source.name || source.path).toLowerCase();
  const bytes = await readBounded(source.path, signal);
  signal?.throwIfAborted();
  const sourceSha256 = sha256(bytes);
  const cached = await readCache(source.path, sourceSha256, extension);
  signal?.throwIfAborted();
  if (cached !== undefined) return { sourceSha256, text: cached };

  const text = RAW_TEXT.has(extension)
    ? await withEmbeddedTables(engine, source, decodeRaw(bytes), sourceSha256, signal)
    : DATA_FILES.has(extension)
      ? await extractTables(engine, source, sourceSha256, signal)
      : await extractCanonical(engine, source.path, extension, sourceSha256, signal);
  signal?.throwIfAborted();
  assertBudget(text);
  const prepared = { sourceSha256, text };
  await writeCache(source.path, extension, prepared);
  return prepared;
}

async function readDataset(
  engine: MaterialExtractEngine,
  source: PreparedMaterialSource,
  fileSha256: string,
  signal?: AbortSignal,
): Promise<Dataset> {
  const dataset = await engine.extractDataset({ schemaVersion: 1, path: source.path }, signal);
  signal?.throwIfAborted();
  if (dataset.source.sha256 !== fileSha256) {
    throw new BadRequestException('Material source hash does not match the file.');
  }
  return dataset;
}

async function extractTables(
  engine: MaterialExtractEngine,
  source: PreparedMaterialSource,
  fileSha256: string,
  signal?: AbortSignal,
): Promise<string> {
  const dataset = await readDataset(engine, source, fileSha256, signal);
  if (dataset.status === 'failed') {
    throw new BadRequestException(
      `Файл «${source.name}» не читается как таблица: ${datasetRefusal(dataset)}.`,
    );
  }
  return datasetText(dataset);
}

/** A text keeps every word; a table found in it adds what its columns hold and how it was read. */
async function withEmbeddedTables(
  engine: MaterialExtractEngine,
  source: PreparedMaterialSource,
  text: string,
  fileSha256: string,
  signal?: AbortSignal,
): Promise<string> {
  const dataset = await readDataset(engine, source, fileSha256, signal);
  if (dataset.status === 'failed' || dataset.sheets.length === 0) return text;
  return text.replace(/\s+$/, '') + NEWLINE + NEWLINE + embeddedTablesText(dataset);
}

async function extractCanonical(
  engine: MaterialExtractEngine,
  path: string,
  extension: string,
  fileSha256: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!EXTRACTED_TEXT.has(extension)) {
    throw new BadRequestException('Unsupported content file type.');
  }
  const built: BuiltText = { text: '', previous: undefined };
  const seen = new Set<number>();
  let offset = 0;
  let sourceSha256: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    signal?.throwIfAborted();
    if (seen.has(offset)) {
      throw new BadRequestException('Material extraction repeated an offset.');
    }
    seen.add(offset);
    const response = await engine.extractMaterial(
      { schemaVersion: 1, path, format: 'text', offset, limit: PAGE_LIMIT },
      signal,
    );
    signal?.throwIfAborted();
    if (response.needsOcr) {
      throw new BadRequestException('PDF has no text layer and needs OCR.');
    }
    if (sourceSha256 === undefined) sourceSha256 = response.sourceSha256;
    else if (response.sourceSha256 !== sourceSha256) {
      throw new BadRequestException('Material source hash changed while the file was read.');
    }
    if (response.sourceSha256 !== fileSha256) {
      throw new BadRequestException('Material source hash does not match the file.');
    }
    for (const segment of response.segments) appendSegment(built, segment);
    if (response.nextOffset === null) {
      if (response.truncated) {
        throw new BadRequestException(
          'Material extraction stopped before the file was fully read.',
        );
      }
      return built.text;
    }
    if (response.nextOffset <= offset) {
      throw new BadRequestException('Material extraction did not advance.');
    }
    offset = response.nextOffset;
  }
  throw new BadRequestException(
    'Material extraction hit its page limit before the file was fully read.',
  );
}

/** Pieces of one locator stay together. A new locator starts a new line. */
function appendSegment(built: BuiltText, segment: Segment): void {
  const key = JSON.stringify([
    segment.locator.page,
    segment.locator.paragraph,
    segment.locator.sheet,
    segment.locator.range,
  ]);
  const piece = segment.text;
  const addition = built.previous === undefined || built.previous === key ? piece : NEWLINE + piece;
  if (built.text.length + addition.length > MAX_CHARS) {
    throw new BadRequestException('Content exceeds 60000 characters.');
  }
  built.text += addition;
  built.previous = key;
}

function assertBudget(text: string): void {
  if (text.length > MAX_CHARS) throw new BadRequestException('Content exceeds 60000 characters.');
}

function decodeRaw(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('Content file is not valid UTF-8.');
  }
}

async function readBounded(path: string, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted();
  try {
    const info = await stat(path);
    signal?.throwIfAborted();
    if (!info.isFile() || info.size > MAX_BYTES) {
      throw new BadRequestException('Content file exceeds 32 MB.');
    }
    return await readBytes(path, info.size, signal);
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    if (signal?.aborted) signal.throwIfAborted();
    throw new BadRequestException('Content file is missing.');
  }
}

async function readBytes(path: string, size: number, signal?: AbortSignal): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    signal?.throwIfAborted();
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = await handle.read(bytes, offset, Math.min(READ_CHUNK, size - offset), offset);
      signal?.throwIfAborted();
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset !== size) throw new BadRequestException('Content file changed while it was read.');
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readCache(
  path: string,
  sourceSha256: string,
  extension: string,
): Promise<string | undefined> {
  const directory = dirname(path);
  try {
    const parsed: unknown = JSON.parse(await readFile(join(directory, CACHE_JSON), 'utf8'));
    if (
      !isCache(parsed) ||
      parsed.sourceSha256 !== sourceSha256 ||
      parsed.extension !== extension
    ) {
      return undefined;
    }
    const text = await readFile(join(directory, CACHE_TEXT), 'utf8');
    if (sha256(text) !== parsed.textSha256 || text.length > MAX_CHARS) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

async function writeCache(
  path: string,
  extension: string,
  prepared: PreparedMaterial,
): Promise<void> {
  try {
    const directory = dirname(path);
    const record: PreparedCache = {
      schemaVersion: 1,
      preparationRevision: PREPARATION_REVISION,
      extension,
      sourceSha256: prepared.sourceSha256,
      textSha256: sha256(prepared.text),
    };
    await atomicWrite(join(directory, CACHE_TEXT), prepared.text);
    await atomicWrite(join(directory, CACHE_JSON), JSON.stringify(record));
  } catch {
    // The brief can still be built when the upload directory cannot store a cache.
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, contents, 'utf8');
  try {
    await rename(temporary, path);
  } catch {
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}

function isCache(value: unknown): value is PreparedCache {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<PreparedCache>;
  return (
    record.schemaVersion === 1 &&
    record.preparationRevision === PREPARATION_REVISION &&
    typeof record.extension === 'string' &&
    record.extension.startsWith('.') &&
    typeof record.sourceSha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(record.sourceSha256) &&
    typeof record.textSha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(record.textSha256)
  );
}

function sha256(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex');
}
