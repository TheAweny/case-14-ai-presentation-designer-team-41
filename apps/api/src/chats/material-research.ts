import { open } from 'node:fs/promises';
import type { MaterialResearchResult, MaterialResearchSource } from '@lct/contracts';

export interface MaterialResearchDependency {
  run(
    question: string,
    sources: readonly MaterialResearchSource[],
    signal: AbortSignal,
  ): Promise<MaterialResearchResult>;
}

const MAX_OFFSET = 1_000_000;
const MAX_CHARS = 12000;
const LOOKAHEAD_CHARS = 2;
const CHUNK_BYTES = 16_384;
/** UTF-8 encodes one UTF-16 unit in at most four bytes, plus a short incomplete-sequence tail. */
const SCAN_SLACK_BYTES = CHUNK_BYTES + 3;
const TEXT_FILE = /\.(txt|md|csv|tsv)$/i;

function highSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function lowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** One UTF-16 page. A cut page is partial, never a complete read. */
export async function readResearchMaterial(
  sourceId: string,
  name: string,
  path: string,
  signal: AbortSignal,
  offset = 0,
): Promise<MaterialResearchSource> {
  signal.throwIfAborted();
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET)
    throw new Error('The material offset is outside the readable range.');
  if (!TEXT_FILE.test(path))
    throw new Error('Research supports only text, Markdown and CSV/TSV files.');
  const file = await open(path, 'r');
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const chunk = Buffer.alloc(CHUNK_BYTES);
    const wanted = MAX_CHARS + LOOKAHEAD_CHARS;
    const scanLimit = 4 * (offset + wanted) + SCAN_SLACK_BYTES;
    let position = 0;
    let scanned = 0;
    let skippedUnits = 0;
    let previousUnit = -1;
    let collected = '';
    let eof = false;
    while (!eof && collected.length < wanted) {
      signal.throwIfAborted();
      const requested = Math.min(chunk.length, scanLimit - scanned);
      if (requested <= 0) throw new Error('The material offset is outside the readable range.');
      const next = await file.read(chunk, 0, requested, position);
      if (next.bytesRead === 0) {
        eof = true;
        break;
      }
      position += next.bytesRead;
      scanned += next.bytesRead;
      const decoded = decoder.decode(chunk.subarray(0, next.bytesRead), { stream: true });
      const need = offset - skippedUnits;
      const take = Math.min(decoded.length, Math.max(0, need));
      if (take > 0) previousUnit = decoded.charCodeAt(take - 1);
      skippedUnits += take;
      collected += decoded.slice(take);
      if (collected.length > wanted) collected = collected.slice(0, wanted);
    }
    signal.throwIfAborted();
    if (!eof && collected.length >= wanted) {
      // Drop unread tail without decoding it; the page already has its boundary lookahead.
    } else {
      collected += decoder.decode();
      if (collected.length > wanted) collected = collected.slice(0, wanted);
    }
    if (skippedUnits < offset) throw new Error('The material offset is past the end of the file.');
    if (offset > 0 && highSurrogate(previousUnit) && lowSurrogate(collected.charCodeAt(0)))
      throw new Error('The material offset starts at a low surrogate.');
    let end = Math.min(MAX_CHARS, collected.length);
    // A page boundary must not split a supplementary character into the next offset.
    if (
      end > 0 &&
      end < collected.length &&
      highSurrogate(collected.charCodeAt(end - 1)) &&
      lowSurrogate(collected.charCodeAt(end))
    )
      end -= 1;
    const text = collected.slice(0, end);
    return {
      sourceId,
      name: name.slice(0, 300),
      offset,
      text,
      truncated: !eof || collected.length > text.length,
    };
  } finally {
    await file.close();
  }
}
