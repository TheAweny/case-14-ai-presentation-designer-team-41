import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MaterialExtractResponse } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import type { ChatToolScope } from './chat-tools.js';
import { materialTools } from './material-tools.js';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const context = (signal: AbortSignal = new AbortController().signal): ToolContext => ({
  callId: 'call',
  signal,
  show: () => 0,
  update: () => undefined,
});

function scope(fileId?: string): ChatToolScope {
  const messages = (): readonly ChatMessage[] =>
    fileId
      ? [
          {
            id: 'message',
            role: 'user',
            parts: [{ type: 'text', text: 'look' }],
            attachments: [{ kind: 'file', fileId, name: 'notes' }],
          } as unknown as ChatMessage,
        ]
      : [];
  return {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'chat',
    model: null,
    messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
}

async function textFile(name: string, text: string) {
  const folder = await mkdtemp(join(tmpdir(), 'material-tools-'));
  folders.push(folder);
  const path = join(folder, name);
  await writeFile(path, text, 'utf8');
  return path;
}

function generation(query: ReturnType<typeof vi.fn>, extractMaterial: ReturnType<typeof vi.fn>) {
  return { pool: { query }, engine: { extractMaterial } } as unknown as GenerationService;
}

describe('material tools', () => {
  it('refuses a file that was not attached before querying storage', async () => {
    const query = vi.fn();
    const tools = materialTools(generation(query, vi.fn()), scope('attached'));
    const tool = tools.find((item) => item.name === 'extract_material');
    if (!tool) throw new Error('missing extract_material');
    await expect(
      tool.run(tool.input.parse({ fileId: crypto.randomUUID() }), context()),
    ).rejects.toThrow(/attached/);
    expect(query).not.toHaveBeenCalled();
    expect(materialTools(generation(query, vi.fn()), scope())).toEqual([]);
  });

  it('reads an attached file the account can see, without splitting an emoji', async () => {
    const fileId = crypto.randomUUID();
    const path = await textFile('notes.txt', 'A\uD83D\uDE00B');
    const query = vi.fn(async () => ({ rows: [{ file_name: 'notes.txt', storage_path: path }] }));
    const extractMaterial = vi.fn();
    const tool = materialTools(generation(query, extractMaterial), scope(fileId)).find(
      (item) => item.name === 'extract_material',
    );
    if (!tool) throw new Error('missing extract_material');
    const page = await tool.run(tool.input.parse({ fileId, offset: 1, limit: 1 }), context());
    expect(page.output).toMatchObject({
      fileId,
      text: '\uD83D\uDE00',
      offset: 1,
      nextOffset: 3,
      coordinateSystem: 'prepared-text-utf16',
    });
    expect(JSON.stringify(page.output).length).toBeLessThan(10_000);
    expect(extractMaterial).not.toHaveBeenCalled();
    await expect(
      tool.run(tool.input.parse({ fileId, offset: 2, limit: 1 }), context()),
    ).rejects.toThrow(/Unicode/);
    await expect(
      tool.run(tool.input.parse({ fileId, offset: 9, limit: 1 }), context()),
    ).rejects.toThrow(/past the end/);
  });

  it('returns every CSV cell, including an empty one and a unit, and refuses one huge row', async () => {
    const fileId = crypto.randomUUID();
    const hash = 'a'.repeat(64);
    const table: NonNullable<MaterialExtractResponse['table']> = {
      sheet: 'Sheet1',
      range: 'A1:B1',
      cells: [
        { address: 'A1', row: 1, column: 1, value: null, formula: null, cached: false },
        { address: 'B1', row: 1, column: 2, value: 'млн', formula: '=A1', cached: true },
      ],
      mergedRanges: ['A1:B1'],
    };
    const extractMaterial = vi.fn(async (): Promise<MaterialExtractResponse> => ({
      schemaVersion: 1,
      kind: 'table',
      sourceSha256: hash,
      segments: [],
      table,
      offset: 0,
      nextOffset: null,
      truncated: false,
      needsOcr: false,
      warnings: [],
    }));
    const query = vi.fn(async () => ({
      rows: [{ file_name: 'budget.csv', storage_path: '/data/budget.csv' }],
    }));
    const tool = materialTools(generation(query, extractMaterial), scope(fileId)).find(
      (item) => item.name === 'read_table',
    );
    if (!tool) throw new Error('missing read_table');
    const read = await tool.run(tool.input.parse({ fileId, limit: 5 }), context());
    expect(read.output).toMatchObject({ fileId, name: 'budget.csv', table });
    const source = table.cells[0];
    if (!source) throw new Error('missing source cell');
    const huge = {
      ...table,
      cells: [
        {
          address: source.address,
          row: source.row,
          column: source.column,
          value: 'x'.repeat(12_000),
          formula: source.formula,
          cached: source.cached,
        },
      ],
    };
    extractMaterial.mockImplementation(async (): Promise<MaterialExtractResponse> => ({
      schemaVersion: 1,
      kind: 'table',
      sourceSha256: hash,
      segments: [],
      table: huge,
      offset: 0,
      nextOffset: null,
      truncated: false,
      needsOcr: false,
      warnings: [],
    }));
    await expect(
      tool.run(tool.input.parse({ fileId, offset: 1, limit: 1 }), context()),
    ).rejects.toThrow(/Narrow the range/);
  });

  it('caches an identical read and stops after eight engine calls, counting failures and a changed hash', async () => {
    const fileId = crypto.randomUUID();
    const path = await textFile('again.txt', 'same');
    const query = vi.fn(async () => ({ rows: [{ file_name: 'again.txt', storage_path: path }] }));
    const tools = materialTools(generation(query, vi.fn()), scope(fileId));
    const extract = tools.find((item) => item.name === 'extract_material');
    if (!extract) throw new Error('missing extract_material');
    await extract.run(extract.input.parse({ fileId }), context());
    await extract.run(extract.input.parse({ fileId }), context());
    expect(query).toHaveBeenCalledTimes(1);

    const hash = createHash('sha256').update(Buffer.from('docx')).digest('hex');
    const docx = await textFile('pages.docx', 'docx');
    let calls = 0;
    const engine = vi.fn(async () => {
      calls += 1;
      return {
        schemaVersion: 1,
        kind: 'text',
        sourceSha256: hash,
        segments: [
          {
            index: 0,
            text: 'p' + calls,
            locator: { page: calls, paragraph: 1, sheet: null, range: null },
          },
        ],
        table: null,
        offset: calls - 1,
        nextOffset: calls,
        truncated: true,
        needsOcr: false,
        warnings: [],
      };
    });
    const docQuery = vi.fn(async () => ({
      rows: [{ file_name: 'pages.docx', storage_path: docx }],
    }));
    const docTools = materialTools(generation(docQuery, engine), scope(fileId));
    const docExtract = docTools.find((item) => item.name === 'extract_material');
    if (!docExtract) throw new Error('missing extract_material');
    await expect(
      docExtract.run(docExtract.input.parse({ fileId, offset: 0, limit: 10 }), context()),
    ).rejects.toThrow(/call limit/);
    expect(engine).toHaveBeenCalledTimes(8);

    const tableEngine = vi.fn(async () => {
      throw new Error('engine down');
    });
    const tableTools = materialTools(
      generation(
        vi.fn(async () => ({ rows: [{ file_name: 't.csv', storage_path: '/t.csv' }] })),
        tableEngine,
      ),
      scope(fileId),
    );
    const table = tableTools.find((item) => item.name === 'read_table');
    if (!table) throw new Error('missing read_table');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        table.run(table.input.parse({ fileId, offset: attempt, limit: 1 }), context()),
      ).rejects.toThrow(/engine down/);
    }
    await expect(
      table.run(table.input.parse({ fileId, offset: 8, limit: 1 }), context()),
    ).rejects.toThrow(/call limit/);
    expect(tableEngine).toHaveBeenCalledTimes(8);
  });

  it('aborts before storage and rejects a table hash that changes between retries', async () => {
    const fileId = crypto.randomUUID();
    const query = vi.fn();
    const controller = new AbortController();
    controller.abort(new Error('stop reading'));
    const tool = materialTools(generation(query, vi.fn()), scope(fileId)).find(
      (item) => item.name === 'extract_material',
    );
    if (!tool) throw new Error('missing extract_material');
    await expect(
      tool.run(tool.input.parse({ fileId }), context(controller.signal)),
    ).rejects.toThrow('stop reading');
    expect(query).not.toHaveBeenCalled();

    const hashes = ['a'.repeat(64), 'b'.repeat(64)];
    let turn = 0;
    const extractMaterial = vi.fn(async () => ({
      schemaVersion: 1,
      kind: 'table',
      sourceSha256: hashes[turn++] ?? hashes[1],
      segments: [],
      table: {
        sheet: 'S',
        range: 'A1:A1',
        cells: [
          {
            address: 'A1',
            row: 1,
            column: 1,
            value: 'x'.repeat(12_000),
            formula: null,
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
    }));
    const table = materialTools(
      generation(
        vi.fn(async () => ({ rows: [{ file_name: 'wide.csv', storage_path: '/wide.csv' }] })),
        extractMaterial,
      ),
      scope(fileId),
    ).find((item) => item.name === 'read_table');
    if (!table) throw new Error('missing read_table');
    await expect(table.run(table.input.parse({ fileId, limit: 4 }), context())).rejects.toThrow(
      /hash changed/,
    );
  });
});
