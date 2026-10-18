import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MaterialExtractResponse } from '@lct/contracts';
import { readPreparedMaterial, type MaterialExtractEngine } from './prepared-material.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function source(name: string, bytes = Buffer.from('saved source bytes')) {
  const folder = await mkdtemp(join(tmpdir(), 'prepared-acceptance-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, bytes);
  return {
    sourceId: crypto.randomUUID(),
    name,
    path,
    hash: createHash('sha256').update(bytes).digest('hex'),
  };
}
const segment = (
  text: string,
  index: number,
  sheet: string | null = null,
  range: string | null = null,
) => ({
  index,
  text,
  locator: { page: null, paragraph: sheet === null ? 1 : null, sheet, range },
});
function page(
  hash: string,
  segments: MaterialExtractResponse['segments'],
  extra: Partial<MaterialExtractResponse> = {},
): MaterialExtractResponse {
  return {
    schemaVersion: 1,
    kind: 'text',
    sourceSha256: hash,
    segments,
    table: null,
    offset: 0,
    nextOffset: null,
    truncated: false,
    needsOcr: false,
    warnings: [],
    ...extra,
  };
}

describe('independent material preparation acceptance', () => {
  it('reads all XLSX sheets with the text endpoint and preserves cell attribution', async () => {
    const file = await source('different-sheets.xlsx');
    const extractMaterial = vi.fn(async (request: { format: string }) => {
      expect(request.format).toBe('text');
      return page(file.hash, [
        segment('Budget 25 млн', 0, 'Plan', 'B2:B2'),
        segment('Actual 19 млн', 1, 'Actual', 'C3:C3'),
      ]);
    });
    const prepared = await readPreparedMaterial({ extractMaterial }, file);
    for (const value of ['Plan', 'B2', 'Budget 25 млн', 'Actual', 'C3', 'Actual 19 млн'])
      expect(prepared.text).toContain(value);
  });

  it('joins a paragraph across engine pages without breaking its number', async () => {
    const file = await source('split.docx');
    const extractMaterial = vi.fn(async (request: { offset?: number }) =>
      request.offset === 0
        ? page(file.hash, [segment('Budget 2', 0)], { truncated: true, nextOffset: 1 })
        : page(file.hash, [segment('5 млн', 1)], { offset: 1 }),
    );
    const prepared = await readPreparedMaterial({ extractMaterial }, file);
    expect(prepared.text).toBe('Budget 25 млн');
    expect(extractMaterial).toHaveBeenCalledTimes(2);
  });

  it('rejects a partial terminal page and a mismatching source hash', async () => {
    const file = await source('partial.pdf');
    await expect(
      readPreparedMaterial(
        {
          extractMaterial: async () =>
            page(file.hash, [segment('Only beginning', 0)], { truncated: true }),
        },
        file,
      ),
    ).rejects.toThrow();
    await expect(
      readPreparedMaterial(
        { extractMaterial: async () => page('b'.repeat(64), [segment('Wrong file', 0)]) },
        file,
      ),
    ).rejects.toThrow();
  });

  it('honors cancellation before opening storage and rejects invalid UTF-8', async () => {
    const engine: MaterialExtractEngine = { extractMaterial: vi.fn() };
    const controller = new AbortController();
    controller.abort(new Error('acceptance cancelled'));
    await expect(
      readPreparedMaterial(
        engine,
        { sourceId: 'id', name: 'absent.txt', path: '/absent/material.txt' },
        controller.signal,
      ),
    ).rejects.toThrow('acceptance cancelled');
    const file = await source('invalid.txt', Buffer.from([0x61, 0xc3]));
    await expect(readPreparedMaterial(engine, file)).rejects.toThrow();
    expect(engine.extractMaterial).not.toHaveBeenCalled();
  });
});
