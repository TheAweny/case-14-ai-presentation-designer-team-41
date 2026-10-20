import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatToolDispatcher, loadChatAgent, toolSpecs } from '@lct/pipeline';
import type { MaterialExtractResponse } from '@lct/contracts';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const folders: string[] = [];
const FILE = '00000000-0000-4000-8000-000000000001';
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
/** The engine's answer for a text with no table in it: the text is then kept as written. */
async function noTable(request: { path: string }) {
  const sha256 = createHash('sha256')
    .update(await readFile(request.path))
    .digest('hex');
  return {
    schemaVersion: 1,
    datasetId: 'dataset-none',
    status: 'failed',
    source: { fileName: 'text', mediaType: 'text/plain', bytes: 0, sha256 },
    sheets: [],
    diagnostics: [{ code: 'no-table', severity: 'error', message: 'No table.' }],
  };
}
async function harness(text: string, extractMaterial = vi.fn(), name = 'source.csv') {
  const folder = await mkdtemp(join(tmpdir(), 'material-live-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, text);
  const query = vi.fn(async () => ({ rows: [{ file_name: name, storage_path: path }] }));
  const scope: ChatToolScope = {
    account: { id: 'owner', role: 'user' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    messages: () => [
      {
        role: 'user',
        id: 'message',
        createdAt: 1,
        text: 'Read my source',
        mode: 'plan',
        attachments: [{ kind: 'file', fileId: FILE, name, size: text.length }],
      },
    ],
    updatePart: vi.fn(),
    addDecks: vi.fn(),
  };
  const tools = chatTools(
    {
      pool: { query },
      engine: { extractMaterial, extractDataset: vi.fn(noTable) },
    } as unknown as GenerationService,
    scope,
    undefined,
    { search: null, fetchSource: vi.fn() },
  );
  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(['extract_material', 'read_table']),
  );
  const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
  const dispatcher = new ChatToolDispatcher({
    tools,
    specs: toolSpecs(agent, tools),
    mode: 'plan',
  });
  const context = {
    callId: 'acceptance',
    signal: new AbortController().signal,
    show: vi.fn(() => 0),
    update: vi.fn(),
  };
  return { dispatcher, context, query, extractMaterial };
}

describe('independent material tools through the live dispatcher', () => {
  it('reads escaped Unicode pages without splitting characters or losing source positions', async () => {
    const original = '😀"\\'.repeat(2000);
    const { dispatcher, context } = await harness(original, vi.fn(), 'source.txt');
    let offset = 0;
    let text = '';
    for (let index = 0; index < 10; index += 1) {
      const result = await dispatcher.dispatch(
        'extract_material',
        JSON.stringify({ fileId: FILE, offset, limit: 5999 }),
        context,
      );
      expect(result.failed).not.toBe(true);
      const page = result.output as {
        text: string;
        offset: number;
        nextOffset: number | null;
        coordinateSystem: string;
      };
      expect(page.coordinateSystem).toBe('prepared-text-utf16');
      expect(page.offset).toBe(offset);
      expect(JSON.stringify(page).length).toBeLessThan(10000);
      expect(page.text).toBe(original.slice(offset, offset + page.text.length));
      expect(/[\uD800-\uDBFF]$/.test(page.text)).toBe(false);
      text += page.text;
      if (page.nextOffset === null) break;
      expect(page.nextOffset).toBeGreaterThan(offset);
      offset = page.nextOffset;
    }
    expect(text).toBe(original);
  });

  it('retains blank cells, units, formula text and range provenance for a CSV table', async () => {
    const response: MaterialExtractResponse = {
      schemaVersion: 1,
      kind: 'table',
      sourceSha256: 'a'.repeat(64),
      segments: [],
      table: {
        sheet: 'Data',
        range: 'A1:B1',
        cells: [
          { address: 'A1', row: 1, column: 1, value: null, formula: null, cached: false },
          {
            address: 'B1',
            row: 1,
            column: 2,
            value: '25 млн ₽',
            formula: '=inert()',
            cached: false,
          },
        ],
        mergedRanges: [],
      },
      offset: 0,
      nextOffset: null,
      truncated: false,
      needsOcr: false,
      warnings: [],
    };
    const extractMaterial = vi.fn(async () => response);
    const { dispatcher, context } = await harness(',25 млн ₽', extractMaterial);
    const result = await dispatcher.dispatch(
      'read_table',
      JSON.stringify({ fileId: FILE, range: 'A1:B1' }),
      context,
    );
    expect(result.failed).not.toBe(true);
    expect(result.output).toMatchObject({ sourceSha256: 'a'.repeat(64), table: response.table });
    expect(extractMaterial.mock.calls).toHaveLength(1);
  });

  it('rejects unattached files before storage for both tools', async () => {
    const { dispatcher, context, query, extractMaterial } = await harness('source');
    for (const name of ['extract_material', 'read_table']) {
      const result = await dispatcher.dispatch(
        name,
        JSON.stringify({ fileId: crypto.randomUUID() }),
        context,
      );
      expect(result.failed).toBe(true);
    }
    expect(query).not.toHaveBeenCalled();
    expect(extractMaterial).not.toHaveBeenCalled();
  });
});
