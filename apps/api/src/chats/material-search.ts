import { open } from 'node:fs/promises';

const MAX_BYTES = 8 * 1024 * 1024;
const LOOKAHEAD_BYTES = 4;
const MAX_CHARS = 2_000_000;
const MAX_OFFSET = 2_000_000;
const MAX_QUERY = 200;
const CONTEXT_CHARS = 120;
const CHUNK_BYTES = 16_384;
const TEXT_FILE = /\.(txt|md|csv|tsv)$/i;
const OUTPUT_LIMIT = 10_000;

export interface MaterialSearchMatch {
  start: number;
  end: number;
  quote: string;
  contextStart: number;
  context: string;
}

export interface MaterialSearchResult {
  sourceId: string;
  name: string;
  matches: MaterialSearchMatch[];
  offset: number;
  /** UTF-16 units searched from offset to the end of the scanned window. */
  scannedChars: number;
  /** Absolute UTF-16 index where the scanned window ends. Match indexes use the same origin. */
  searchedEnd: number;
  nextOffset: number | null;
  complete: boolean;
  limitReached?: boolean;
}

export interface MaterialSearchInput {
  sourceId: string;
  name: string;
  path: string;
  query: string;
  offset?: number;
  limit?: number;
  signal: AbortSignal;
}

function highSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function lowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

function boundedName(name: string): string {
  const cut = name.slice(0, 300);
  return highSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

function escapeLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function codePointStart(text: string, index: number): number {
  if (index > 0 && index < text.length && lowSurrogate(text.charCodeAt(index))) return index - 1;
  return index;
}

function codePointEnd(text: string, index: number): number {
  if (
    index > 0 &&
    index < text.length &&
    highSurrogate(text.charCodeAt(index - 1)) &&
    lowSurrogate(text.charCodeAt(index))
  )
    return index + 1;
  return index;
}

function pageOffset(text: string, start: number): number | null {
  let next = start + 1;
  if (next < text.length && lowSurrogate(text.charCodeAt(next))) next += 1;
  if (next > text.length) return null;
  return next;
}

function fitOutput(result: MaterialSearchResult): MaterialSearchResult {
  const encoded = () => JSON.stringify(result).length;
  if (encoded() < OUTPUT_LIMIT) return result;
  for (const match of result.matches) {
    match.context = match.quote;
    match.contextStart = match.start;
  }
  const before = result.matches.length;
  while (encoded() >= OUTPUT_LIMIT && result.matches.length > 0) result.matches.pop();
  if (result.matches.length === before) return result;
  const kept = result.matches[result.matches.length - 1];
  if (kept) {
    const step = highSurrogate(kept.quote.charCodeAt(0)) ? 2 : 1;
    result.nextOffset = kept.start + step;
    result.complete = false;
    delete result.limitReached;
  } else {
    result.nextOffset = result.offset;
    result.complete = false;
  }
  if (encoded() >= OUTPUT_LIMIT) throw new Error('The search result exceeds 10000 characters.');
  return result;
}

async function readBounded(
  path: string,
  signal: AbortSignal,
): Promise<{ text: string; hardLimit: boolean }> {
  const file = await open(path, 'r');
  try {
    signal.throwIfAborted();
    const opened = await file.stat();
    const byteLimit = Math.min(opened.size, MAX_BYTES + LOOKAHEAD_BYTES);
    const chunk = Buffer.alloc(CHUNK_BYTES);
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let position = 0;
    let text = '';
    let eof = opened.size === 0;
    while (!eof && position < byteLimit && text.length <= MAX_CHARS) {
      signal.throwIfAborted();
      const requested = Math.min(chunk.length, byteLimit - position);
      const next = await file.read(chunk, 0, requested, position);
      if (next.bytesRead === 0) {
        eof = true;
        break;
      }
      position += next.bytesRead;
      try {
        text += decoder.decode(chunk.subarray(0, next.bytesRead), { stream: true });
      } catch {
        throw new Error('The material file is not valid UTF-8.');
      }
    }
    signal.throwIfAborted();
    const current = await file.stat();
    if (current.size !== opened.size)
      throw new Error('The material file changed while it was read.');
    if (position >= opened.size) {
      try {
        text += decoder.decode();
      } catch {
        throw new Error('The material file is not valid UTF-8.');
      }
    }
    let hardLimit = position < opened.size || opened.size > MAX_BYTES;
    if (text.length > MAX_CHARS) {
      let end = MAX_CHARS;
      if (highSurrogate(text.charCodeAt(end - 1)) && lowSurrogate(text.charCodeAt(end))) end -= 1;
      text = text.slice(0, end);
      hardLimit = true;
    }
    return { text, hardLimit };
  } finally {
    await file.close();
  }
}

export async function searchMaterialFile(
  input: MaterialSearchInput,
): Promise<MaterialSearchResult> {
  const signal = input.signal;
  signal.throwIfAborted();
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 5;
  const query = input.query.trim();
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET)
    throw new Error('The material offset is outside the readable range.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new Error('The search limit must be from 1 to 10.');
  if (query.length < 1 || query.length > MAX_QUERY)
    throw new Error('The search query must be from 1 to 200 characters.');
  if (!TEXT_FILE.test(input.path) && !TEXT_FILE.test(input.name))
    throw new Error('Search supports only text, Markdown and CSV/TSV files.');

  const { text, hardLimit } = await readBounded(input.path, signal);
  if (offset > text.length && !hardLimit)
    throw new Error('The material offset is past the end of the file.');
  if (offset > text.length && hardLimit)
    throw new Error('The material offset is outside the readable range.');
  if (offset < text.length && lowSurrogate(text.charCodeAt(offset)))
    throw new Error('The material offset starts at a low surrogate.');

  const pattern = new RegExp(escapeLiteral(query), 'giu');
  pattern.lastIndex = offset;
  const matches: MaterialSearchMatch[] = [];
  while (matches.length < limit) {
    const found = pattern.exec(text);
    if (!found || found.index < offset) break;
    const start = found.index;
    const quote = text.slice(start, start + found[0].length);
    const end = start + quote.length;
    const contextStart = codePointStart(text, Math.max(0, start - CONTEXT_CHARS));
    const contextEnd = codePointEnd(text, Math.min(text.length, end + CONTEXT_CHARS));
    matches.push({
      start,
      end,
      quote,
      contextStart,
      context: text.slice(contextStart, contextEnd),
    });
    const advance = pageOffset(text, start);
    if (advance === null || advance <= start || advance > text.length) break;
    pattern.lastIndex = advance;
  }

  const last = matches[matches.length - 1];
  const hitLimit = matches.length === limit;
  let nextOffset: number | null = null;
  let complete = !hardLimit;
  let limitReached = false;
  if (hitLimit && last) {
    const next = pageOffset(text, last.start);
    if (next !== null && next < text.length) {
      nextOffset = next;
      complete = false;
    } else if (hardLimit) {
      nextOffset = null;
      complete = false;
      limitReached = true;
    } else {
      nextOffset = null;
      complete = true;
    }
  } else if (hardLimit) {
    nextOffset = null;
    complete = false;
    limitReached = true;
  }

  return fitOutput({
    sourceId: input.sourceId,
    name: boundedName(input.name),
    matches,
    offset,
    scannedChars: text.length - offset,
    searchedEnd: text.length,
    nextOffset,
    complete,
    ...(limitReached ? { limitReached: true } : {}),
  });
}
