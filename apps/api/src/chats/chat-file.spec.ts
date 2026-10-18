import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('read_file pagination', () => {
  it('reads the final correction after the first 20,000 characters with bounded pages', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chat-file-'));
    directories.push(directory);
    const path = join(directory, 'brief.txt');
    const text = `${'а'.repeat(21000)}Исправление: бюджет 9 млн`;
    await writeFile(path, text);
    const fileId = '00000000-0000-4000-8000-0000000000a1';
    const messages: ChatMessage[] = [
      {
        role: 'user',
        id: 'user',
        createdAt: 1,
        mode: 'plan',
        text: 'Материал',
        attachments: [{ kind: 'file', fileId, name: 'brief.txt', size: text.length }],
      },
    ];
    const generation = {
      pool: { query: async () => ({ rows: [{ file_name: 'brief.txt', storage_path: path }] }) },
    } as unknown as GenerationService;
    const scope: ChatToolScope = {
      account: { id: 'owner' } as Account,
      chatId: 'chat',
      projectId: null,
      mode: 'plan',
      model: null,
      messages: () => messages,
      updatePart: () => undefined,
      addDecks: () => undefined,
    };
    const tool = chatTools(generation, scope).find((item) => item.name === 'read_file');
    if (!tool) throw new Error('Missing read_file');
    const context: ToolContext = {
      callId: 'read',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    };
    const first = await tool.run(tool.input.parse({ fileId, offset: 0, limit: 8000 }), context);
    const metadata = first.output as { offset: number; nextOffset: number; totalChars: number };
    expect([metadata.offset, metadata.nextOffset, metadata.totalChars]).toEqual([
      0,
      8000,
      text.length,
    ]);
    const last = await tool.run(tool.input.parse({ fileId, offset: 21000, limit: 8000 }), context);
    expect(last.output).toMatchObject({
      text: 'Исправление: бюджет 9 млн',
      offset: 21000,
      nextOffset: null,
      totalChars: text.length,
    });
  });
});
