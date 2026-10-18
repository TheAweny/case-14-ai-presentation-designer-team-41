import { z } from 'zod';
import type { ChatTool, ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import { visibleFile } from '../files/template-visibility.js';
import { readPreparedMaterial } from '../materials/prepared-material.js';
import type { ChatToolScope } from './chat-tools.js';

const MAX_OUTPUT_CHARS = 10_000;
const MAX_ENGINE_CALLS = 8;
const MAX_TABLE_ATTEMPTS = 5;
const MAX_NAME_CHARS = 300;
const CELL_RANGE = /^[A-Z]{1,3}[1-9][0-9]{0,6}:[A-Z]{1,3}[1-9][0-9]{0,6}$/;

const extractInput = z.object({
  fileId: z.string().uuid(),
  offset: z.number().int().min(0).max(60_000).default(0),
  limit: z.number().int().min(1).max(6_000).default(4_000),
  expectedSourceSha256: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
});

const tableInput = z.object({
  fileId: z.string().uuid(),
  sheet: z.string().trim().min(1).max(200).optional(),
  range: z.string().regex(CELL_RANGE).optional(),
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(20).default(5),
});

interface StoredContent {
  readonly file_name: string;
  readonly storage_path: string;
}

interface ExtractOutput {
  readonly fileId: string;
  readonly name: string;
  readonly sourceSha256: string;
  readonly text: string;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly truncated: boolean;
  readonly totalChars: number;
  readonly coordinateSystem: 'prepared-text-utf16';
}

interface TableOutput {
  readonly fileId: string;
  readonly name: string;
  readonly sourceSha256: string;
  readonly kind: 'table';
  readonly sheet: string | null;
  readonly range: string | null;
  readonly table: unknown;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly truncated: boolean;
  readonly warnings: readonly string[];
}

type ExtractRequest = Parameters<GenerationService['engine']['extractMaterial']>[0];

/** File ids the person attached in this chat. Nothing else may be read. */
export function attachedFileIds(scope: ChatToolScope): ReadonlySet<string> {
  return new Set(
    scope
      .messages()
      .flatMap((message) =>
        message.role === 'user'
          ? message.attachments.flatMap((item) => (item.kind === 'file' ? [item.fileId] : []))
          : [],
      ),
  );
}

/**
 * Material tools for one turn. They are offered only when this chat has a file attachment.
 * Another module registers them with the rest of the chat tools.
 */
export function materialTools(generation: GenerationService, scope: ChatToolScope): ChatTool[] {
  if (attachedFileIds(scope).size === 0) return [];
  const cache = new Map<string, unknown>();
  let engineCalls = 0;
  const limitedEngine = {
    async extractMaterial(request: ExtractRequest, signal?: AbortSignal) {
      if (engineCalls >= MAX_ENGINE_CALLS) {
        throw new Error('The material engine call limit for this turn was reached.');
      }
      engineCalls += 1;
      return generation.engine.extractMaterial(request, signal);
    },
  };

  const extractMaterial: ChatTool = {
    name: 'extract_material',
    input: extractInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = extractInput.parse(input);
      const key = JSON.stringify(['extract', request]);
      const cached = cache.get(key);
      if (cached) return { output: cached };
      const stored = await requireContent(generation, scope, request.fileId, context);
      context.signal.throwIfAborted();
      const prepared = await readPreparedMaterial(
        limitedEngine,
        { sourceId: request.fileId, name: stored.file_name, path: stored.storage_path },
        context.signal,
      );
      context.signal.throwIfAborted();
      if (
        request.expectedSourceSha256 &&
        request.expectedSourceSha256.toLowerCase() !== prepared.sourceSha256.toLowerCase()
      ) {
        throw new Error('The material changed since the expected source hash.');
      }
      const output = pageText(
        request.fileId,
        stored.file_name,
        prepared,
        request.offset,
        request.limit,
      );
      cache.set(key, output);
      return { output };
    },
  };

  const readTable: ChatTool = {
    name: 'read_table',
    input: tableInput,
    modes: ['chat', 'plan', 'auto'],
    async run(input, context) {
      context.signal.throwIfAborted();
      const request = tableInput.parse(input);
      const key = JSON.stringify(['table', request]);
      const cached = cache.get(key);
      if (cached) return { output: cached };
      const stored = await requireContent(generation, scope, request.fileId, context);
      let limit = request.limit;
      let last: TableOutput | undefined;
      let seenHash: string | undefined;
      for (let attempt = 0; attempt < MAX_TABLE_ATTEMPTS; attempt += 1) {
        context.signal.throwIfAborted();
        const response = await limitedEngine.extractMaterial(
          {
            schemaVersion: 1,
            path: stored.storage_path,
            format: 'table',
            offset: request.offset,
            limit,
            ...(request.sheet ? { sheet: request.sheet } : {}),
            ...(request.range ? { range: request.range } : {}),
          },
          context.signal,
        );
        context.signal.throwIfAborted();
        if (response.kind !== 'table' || response.table === null) {
          throw new Error('The engine did not return a table for this material.');
        }
        if (seenHash !== undefined && response.sourceSha256 !== seenHash) {
          throw new Error('Material source hash changed while the table was read.');
        }
        seenHash = response.sourceSha256;
        last = {
          fileId: request.fileId,
          name: clipName(stored.file_name),
          sourceSha256: response.sourceSha256,
          kind: 'table',
          sheet: request.sheet ?? response.table.sheet,
          range: request.range ?? response.table.range,
          table: response.table,
          offset: response.offset,
          nextOffset: response.nextOffset,
          truncated: response.truncated,
          warnings: response.warnings,
        };
        if (jsonSize(last) < MAX_OUTPUT_CHARS) break;
        if (limit === 1) break;
        limit = Math.max(1, Math.floor(limit / 2));
      }
      if (!last || jsonSize(last) >= MAX_OUTPUT_CHARS) {
        throw new Error('One table row is too large. Narrow the range.');
      }
      cache.set(key, last);
      return { output: last };
    },
  };

  return [extractMaterial, readTable];
}

async function requireContent(
  generation: GenerationService,
  scope: ChatToolScope,
  fileId: string,
  context: ToolContext,
): Promise<StoredContent> {
  if (!attachedFileIds(scope).has(fileId)) {
    throw new Error('Read may use only materials attached by the person in this chat.');
  }
  context.signal.throwIfAborted();
  const found = await generation.pool.query<StoredContent>(
    "SELECT file_name, storage_path FROM stored_files WHERE id = $1 AND kind = 'content' AND " +
      visibleFile(2),
    [fileId, scope.account.id],
  );
  const stored = found.rows[0];
  if (!stored) throw new Error('There is no such material available to this account.');
  return stored;
}

function pageText(
  fileId: string,
  fileName: string,
  prepared: { readonly sourceSha256: string; readonly text: string },
  offset: number,
  requested: number,
): ExtractOutput {
  const text = prepared.text;
  if (offset > text.length) throw new Error('Offset is past the end of the prepared text.');
  if (isLowSurrogate(text, offset)) {
    throw new Error('Offset splits a Unicode character. Continue from the previous nextOffset.');
  }
  const name = clipName(fileName);
  let end = Math.min(text.length, offset + requested);
  end = retreat(text, offset, end);
  if (end === offset && offset < text.length) end = nextCodePoint(text, offset);
  while (end > offset && jsonSize(draft(end)) >= MAX_OUTPUT_CHARS) {
    const smaller = retreat(text, offset, end - 1);
    if (smaller >= end) break;
    end = smaller;
  }
  const output = draft(end);
  if (jsonSize(output) >= MAX_OUTPUT_CHARS) {
    throw new Error('The material page does not fit in the tool result. Narrow the limit.');
  }
  if (output.nextOffset === offset) {
    throw new Error('The material page did not advance. Narrow the limit.');
  }
  return output;

  function draft(cursor: number): ExtractOutput {
    return {
      fileId,
      name,
      sourceSha256: prepared.sourceSha256,
      text: text.slice(offset, cursor),
      offset,
      nextOffset: cursor < text.length ? cursor : null,
      truncated: cursor < text.length,
      totalChars: text.length,
      coordinateSystem: 'prepared-text-utf16',
    };
  }
}

function clipName(name: string): string {
  return name.slice(0, retreat(name, 0, Math.min(name.length, MAX_NAME_CHARS)));
}

function retreat(text: string, start: number, end: number): number {
  if (end > start && isLowSurrogate(text, end) && isHighSurrogate(text, end - 1)) return end - 1;
  return end;
}

function nextCodePoint(text: string, index: number): number {
  if (isHighSurrogate(text, index) && isLowSurrogate(text, index + 1)) return index + 2;
  return Math.min(text.length, index + 1);
}

function isHighSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

function jsonSize(value: unknown): number {
  return JSON.stringify(value).length;
}
