import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { searchMaterialFile } from './material-search.js';

let directory: string | undefined;

async function tempFile(name: string, contents: string | Buffer): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), 'material-search-'));
  const path = join(directory, name);
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  if (!directory) return;
  await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('searchMaterialFile', () => {
  it('keeps BOM, dotted I and emoji at their UTF-16 offsets', async () => {
    const text = '﻿İ😀tail';
    const path = await tempFile('notes.txt', text);
    const signal = new AbortController().signal;
    const dotted = await searchMaterialFile({
      sourceId: 's',
      name: 'notes.txt',
      path,
      query: 'İ',
      signal,
    });
    const emoji = await searchMaterialFile({
      sourceId: 's',
      name: 'notes.txt',
      path,
      query: '😀',
      signal,
    });
    expect(dotted.matches[0]).toMatchObject({ start: 1, end: 2, quote: 'İ' });
    expect(emoji.matches[0]).toMatchObject({ start: 2, end: 4, quote: '😀' });
    expect(dotted.scannedChars).toBe(text.length);
    expect(dotted.searchedEnd).toBe(text.length);
    expect(JSON.stringify(dotted).length).toBeLessThan(10_000);
  });

  it('treats regex metacharacters as a literal', async () => {
    const path = await tempFile('row.csv', 'axb a.b');
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'row.csv',
      path,
      query: 'a.b',
      signal: new AbortController().signal,
    });
    expect(result.matches.map((match) => match.start)).toEqual([4]);
    expect(result.matches[0]?.quote).toBe('a.b');
  });

  it('finds a token that crosses a 16KiB read', async () => {
    const path = await tempFile('chunk.md', 'a'.repeat(16_383) + 'SPLIT');
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'chunk.md',
      path,
      query: 'split',
      signal: new AbortController().signal,
    });
    expect(result.matches[0]).toMatchObject({ start: 16_383, end: 16_388, quote: 'SPLIT' });
    expect(result.complete).toBe(true);
  });

  it('pages overlapping matches one code point ahead', async () => {
    const path = await tempFile('overlap.txt', 'aaa');
    const signal = new AbortController().signal;
    const first = await searchMaterialFile({
      sourceId: 's',
      name: 'overlap.txt',
      path,
      query: 'aa',
      limit: 1,
      signal,
    });
    expect(first.matches.map((match) => match.start)).toEqual([0]);
    expect(first.nextOffset).toBe(1);
    expect(first.complete).toBe(false);
    const second = await searchMaterialFile({
      sourceId: 's',
      name: 'overlap.txt',
      path,
      query: 'aa',
      offset: first.nextOffset ?? 0,
      limit: 1,
      signal,
    });
    expect(second.matches.map((match) => match.start)).toEqual([1]);
  });

  it('does not report the same emoji ten times', async () => {
    const path = await tempFile('emoji.txt', '🙂🙂');
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'emoji.txt',
      path,
      query: '🙂',
      limit: 10,
      signal: new AbortController().signal,
    });
    expect(result.matches.map((match) => match.start)).toEqual([0, 2]);
    expect(result.complete).toBe(true);
  });

  it('finds a needle after 80k characters without returning the whole file', async () => {
    const path = await tempFile('late.tsv', 'x'.repeat(80_000) + 'Late');
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'late.tsv',
      path,
      query: 'late',
      signal: new AbortController().signal,
    });
    expect(result.matches[0]).toMatchObject({ start: 80_000, quote: 'Late' });
    expect(result.matches[0]?.contextStart).toBe(80_000 - 120);
    expect((result.matches[0]?.context.length ?? 0) <= 120 + 4).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
  });

  it('stops a miss at the character cap and does not pretend the file ended', async () => {
    const path = await tempFile('big.txt', 'a'.repeat(2_000_000) + 'UNIQUE');
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'big.txt',
      path,
      query: 'UNIQUE',
      signal: new AbortController().signal,
    });
    expect(result.matches).toEqual([]);
    expect(result.scannedChars).toBe(2_000_000);
    expect(result.searchedEnd).toBe(2_000_000);
    expect(result.complete).toBe(false);
    expect(result.nextOffset).toBeNull();
    expect(result.limitReached).toBe(true);
  });

  it('rejects a low surrogate offset, an aborted read and invalid UTF-8', async () => {
    const path = await tempFile('wide.txt', 'a😀b');
    const signal = new AbortController().signal;
    await expect(
      searchMaterialFile({ sourceId: 's', name: 'wide.txt', path, query: 'b', offset: 2, signal }),
    ).rejects.toThrow(/surrogate/);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      searchMaterialFile({
        sourceId: 's',
        name: 'wide.txt',
        path,
        query: 'b',
        signal: aborted.signal,
      }),
    ).rejects.toThrow(/abort/i);
    const broken = await tempFile('broken.txt', Buffer.from([0xc3]));
    await expect(
      searchMaterialFile({ sourceId: 's', name: 'broken.txt', path: broken, query: 'a', signal }),
    ).rejects.toThrow(/UTF-8/);
  });

  it('keeps quotes and drops later matches when control characters blow the budget', async () => {
    const query = ''.repeat(200);
    const path = await tempFile('controls.txt', query.repeat(10));
    const result = await searchMaterialFile({
      sourceId: 's',
      name: 'n'.repeat(400) + '.txt',
      path,
      query,
      limit: 10,
      signal: new AbortController().signal,
    });
    expect(result.name).toHaveLength(300);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeLessThan(10);
    expect(result.matches.every((match) => match.quote === query && match.context === query)).toBe(
      true,
    );
    expect(result.complete).toBe(false);
    expect(result.nextOffset).toBe((result.matches[result.matches.length - 1]?.start ?? 0) + 1);
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
  });
});
