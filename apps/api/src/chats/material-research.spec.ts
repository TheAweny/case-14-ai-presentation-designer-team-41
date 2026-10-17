import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MaterialResearchResult } from '@lct/contracts';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';
import { readResearchMaterial } from './material-research.js';

const fileId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function file(text = 'Бюджет: 25 рублей.') {
  const directory = await mkdtemp(join(tmpdir(), 'material-research-'));
  directories.push(directory);
  const path = join(directory, 'brief.txt');
  await writeFile(path, text);
  return path;
}
function output(): MaterialResearchResult {
  return {
    outputTruncated: false,
    summary: '',
    evidence: [],
    openQuestions: [],
    coverage: [],
    manifest: {
      agentId: 'material-researcher',
      agentVersion: '0.1.0',
      instructionsSha256: 'a'.repeat(64),
      model: 'recorded',
      modelRevision: null,
      seed: 42,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
}
function setup(path: string, attached = [fileId], visible = true) {
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
    rows: visible ? [{ file_name: 'brief.txt', storage_path: path }] : [],
  }));
  const generation = { pool: { query } } as unknown as GenerationService;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      id: 'user',
      createdAt: 1,
      mode: 'plan',
      text: 'Исследуй бюджет',
      attachments: attached.map((id) => ({
        kind: 'file',
        fileId: id,
        name: 'brief.txt',
        size: 100,
      })),
    },
  ];
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
  const run = vi.fn(async () => output());
  const tools = chatTools(generation, scope, { run });
  const tool = tools.find((item) => item.name === 'research_materials');
  if (!tool) throw new Error('Research tool missing');
  const context: ToolContext = {
    callId: 'research',
    signal: new AbortController().signal,
    show: () => 0,
    update: () => undefined,
  };
  return { query, run, tool, tools, context, generation, scope };
}

describe('material research in chat tools', () => {
  it('reads only attached visible materials and passes the cancellation signal', async () => {
    const { tool, run, query, context } = setup(await file());
    await tool.run({ question: 'Какой бюджет?', fileIds: [fileId] }, context);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("kind = 'content'"), [
      fileId,
      'owner',
    ]);
    expect(query.mock.calls[0]?.[0]).toContain('owner_id');
    expect(run).toHaveBeenCalledWith(
      'Какой бюджет?',
      [
        {
          sourceId: fileId,
          name: 'brief.txt',
          offset: 0,
          text: 'Бюджет: 25 рублей.',
          truncated: false,
        },
      ],
      context.signal,
    );
  });

  it('denies an unattached file before storage even when an offset is supplied', async () => {
    const { tool, run, query, context } = setup('unused');
    await expect(
      tool.run({ question: 'Вопрос', fileIds: [otherId], offsets: { [otherId]: 12000 } }, context),
    ).rejects.toThrow(/attached/);
    expect(query).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses unattached ids before querying storage or calling a model', async () => {
    const { tool, run, query, context } = setup('unused');
    await expect(tool.run({ question: 'Вопрос', fileIds: [otherId] }, context)).rejects.toThrow(
      /attached/,
    );
    expect(query).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rechecks account visibility for an attached id', async () => {
    const { tool, run, context } = setup('unused', [fileId], false);
    await expect(tool.run({ question: 'Вопрос', fileIds: [fileId] }, context)).rejects.toThrow(
      /available/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('caps child calls per turn and rejects already cancelled work', async () => {
    const { tool, run, context } = setup(await file());
    const input = { question: 'Вопрос', fileIds: [fileId] };
    await tool.run(input, context);
    await tool.run(input, context);
    await expect(tool.run(input, context)).rejects.toThrow(/limit/);
    expect(run).toHaveBeenCalledTimes(2);
    await expect(tool.run(input, { ...context, signal: AbortSignal.abort() })).rejects.toThrow();
  });

  it('exposes the registry-described tool in all modes only with a research dependency', async () => {
    const { generation, scope, run } = setup('unused');
    const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
    for (const mode of ['chat', 'plan', 'auto'] as const) {
      const tools = chatTools(generation, { ...scope, mode }, { run });
      expect(
        toolSpecs(agent, tools).find((item) => item.name === 'research_materials')?.description
          .length,
      ).toBeGreaterThan(40);
    }
    expect(chatTools(generation, scope).some((item) => item.name === 'research_materials')).toBe(
      false,
    );
  });

  it('rejects invalid inputs at the actual chat dispatch boundary without model calls', async () => {
    const { tools, run, context } = setup('unused');
    const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
    const dispatcher = new ChatToolDispatcher({
      tools,
      specs: toolSpecs(agent, tools),
      mode: 'plan',
    });
    const outcome = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({ question: '', fileIds: [fileId] }),
      context,
    );
    expect(outcome.failed).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('bounded material reads', () => {
  it('leaves the next page at a complete supplementary Unicode character', async () => {
    const text = `${'x'.repeat(11999)}😀tail`;
    const result = await readResearchMaterial(
      fileId,
      'brief.txt',
      await file(text),
      new AbortController().signal,
    );
    expect(result.text).toBe('x'.repeat(11999));
    expect(result.truncated).toBe(true);
    expect(text.slice(result.text.length)).toBe('😀tail');
  });

  it('does not fail when the byte cap splits a UTF-8 character', async () => {
    const text = `${'я'.repeat(32767)}😀tail`;
    const result = await readResearchMaterial(
      fileId,
      'brief.txt',
      await file(text),
      new AbortController().signal,
    );
    expect(result.text).toBe(text.slice(0, 12000));
    expect(result.truncated).toBe(true);
  });

  it('reports partial reading and preserves exact original text including line breaks', async () => {
    const text = `Заголовок\r\n${'я'.repeat(14000)}CORRECTION_AFTER_LIMIT`;
    const result = await readResearchMaterial(
      fileId,
      'brief.txt',
      await file(text),
      new AbortController().signal,
    );
    expect(result.text).toBe(text.slice(0, 12000));
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain('CORRECTION_AFTER_LIMIT');
  });

  it('reads a long CJK page without treating the byte budget as an error', async () => {
    const text = '漢'.repeat(20000);
    const result = await readResearchMaterial(
      fileId,
      'brief.txt',
      await file(text),
      new AbortController().signal,
    );
    expect(result.offset).toBe(0);
    expect(result.text).toBe(text.slice(0, 12000));
    expect(result.truncated).toBe(true);
  });

  it('finds a correction after 21000 characters on the second page', async () => {
    const marker = 'ПОПРАВКА_ПОСЛЕ_21000';
    const text = 'а'.repeat(21000) + marker;
    const path = await file(text);
    const signal = new AbortController().signal;
    const first = await readResearchMaterial(fileId, 'brief.txt', path, signal, 0);
    expect(first.offset).toBe(0);
    expect(first.text).toBe(text.slice(0, 12000));
    expect(first.truncated).toBe(true);
    expect(first.text).not.toContain(marker);
    const second = await readResearchMaterial(fileId, 'brief.txt', path, signal, 12000);
    expect(second).toMatchObject({
      offset: 12000,
      text: text.slice(12000, 24000),
      truncated: false,
    });
    expect(second.text).toContain(marker);
  });

  it('rejects a low surrogate offset and an offset past the end', async () => {
    const text = 'x'.repeat(11999) + '😀tail';
    const path = await file(text);
    const signal = new AbortController().signal;
    await expect(readResearchMaterial(fileId, 'brief.txt', path, signal, 12000)).rejects.toThrow(
      /low surrogate/,
    );
    await expect(
      readResearchMaterial(fileId, 'brief.txt', path, signal, text.length + 1),
    ).rejects.toThrow(/past the end/);
    const atEnd = await readResearchMaterial(fileId, 'brief.txt', path, signal, text.length);
    expect(atEnd).toMatchObject({ offset: text.length, text: '', truncated: false });
  });

  it('accepts the one million offset cap and rejects invalid offsets', async () => {
    const path = await file('a'.repeat(1_000_000));
    const signal = new AbortController().signal;
    const atCap = await readResearchMaterial(fileId, 'brief.txt', path, signal, 1_000_000);
    expect(atCap).toMatchObject({ offset: 1_000_000, text: '', truncated: false });
    await expect(
      readResearchMaterial(fileId, 'brief.txt', path, signal, 1_000_001),
    ).rejects.toThrow(/readable range/);
    await expect(readResearchMaterial(fileId, 'brief.txt', path, signal, -1)).rejects.toThrow(
      /readable range/,
    );
    await expect(readResearchMaterial(fileId, 'brief.txt', path, signal, 1.5)).rejects.toThrow(
      /readable range/,
    );
  });

  it('reads a later CJK page inside the byte budget', async () => {
    const text = '漢'.repeat(20000);
    const result = await readResearchMaterial(
      fileId,
      'brief.txt',
      await file(text),
      new AbortController().signal,
      8000,
    );
    expect(result).toMatchObject({
      offset: 8000,
      text: text.slice(8000, 20000),
      truncated: false,
    });
  });

  it('keeps a BOM and CRLF when the page starts after them', async () => {
    const text = '\uFEFF\r\nnote';
    const path = await file(text);
    const signal = new AbortController().signal;
    const whole = await readResearchMaterial(fileId, 'brief.txt', path, signal, 0);
    expect(whole.text).toBe(text);
    expect(whole.text.charCodeAt(0)).toBe(0xfeff);
    const result = await readResearchMaterial(fileId, 'brief.txt', path, signal, 1);
    expect(result).toMatchObject({ offset: 1, text: '\r\nnote', truncated: false });
  });

  it('refuses unsupported files before opening them', async () => {
    await expect(
      readResearchMaterial(fileId, 'template.pptx', 'missing.pptx', new AbortController().signal),
    ).rejects.toThrow(/only text/);
  });
});
