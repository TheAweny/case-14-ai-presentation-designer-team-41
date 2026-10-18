import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { searchMaterialFile } from './material-search.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function file(content: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'material-search-acceptance-'));
  directories.push(directory);
  const path = join(directory, 'brief.txt');
  await writeFile(path, content);
  return {
    path,
    sourceId: '00000000-0000-4000-8000-000000000001',
    name: 'brief.txt',
    signal: new AbortController().signal,
  };
}

describe('independent material search counterexamples', () => {
  it('rejects an unfinished UTF-8 sequence at the actual end of the file', async () => {
    await expect(
      searchMaterialFile({ ...(await file(Buffer.from([0xc3]))), query: 'бюджет' }),
    ).rejects.toThrow(/UTF-8/i);
  });

  it('advances across whole Unicode code points while preserving overlapping matches', async () => {
    const emoji = await searchMaterialFile({ ...(await file('🙂🙂')), query: '🙂', limit: 10 });
    expect(emoji.matches.map((match) => match.start)).toEqual([0, 2]);
    const overlap = await searchMaterialFile({ ...(await file('aaaa')), query: 'aa', limit: 10 });
    expect(overlap.matches.map((match) => match.start)).toEqual([0, 1, 2]);
  });

  it('bounds escaped JSON without dropping a continuation cursor', async () => {
    const result = await searchMaterialFile({
      ...(await file('\u0000'.repeat(2400))),
      query: '\u0000'.repeat(200),
      limit: 10,
    });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(JSON.stringify(result).length).toBeLessThan(10000);
    expect(result.complete).toBe(false);
    expect(result.nextOffset).toBeGreaterThan(0);
  });

  it('describes the searched span after a nonzero offset', async () => {
    const result = await searchMaterialFile({ ...(await file('🙂ab🙂')), query: 'ab', offset: 2 });
    expect(result.matches[0]).toMatchObject({ start: 2, end: 4, quote: 'ab' });
    expect(result.scannedChars).toBe(4);
  });
});
