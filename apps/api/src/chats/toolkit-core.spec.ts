import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@lct/contracts';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import type { Account } from '../accounts/account-rules.js';
import { chatTools, type ChatToolScope, type ChatWebDependency } from './chat-tools.js';
import type { WebSearchAnswer } from './web-search.js';
import type { WebSourcePage } from './web-source.js';

const FILE = '00000000-0000-4000-8000-000000000001';
const FOREIGN = '00000000-0000-4000-8000-000000000002';
const TEMPLATE = '00000000-0000-4000-8000-000000000003';
const directories: string[] = [];
const REGISTRY = join(import.meta.dirname, '../../../../registry/agents');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function profile() {
  const fixturePath = join(
    import.meta.dirname,
    '../../../../packages/contracts/fixtures/GenerationProfile.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    valid: Array<{ payload: { compositions: Array<{ patternId: string }> } }>;
  };
  const payload = fixture.valid[0]?.payload;
  if (!payload) throw new Error('fixture has no payload');
  return payload;
}

function scope(attached: string[]): ChatToolScope {
  const messages: ChatMessage[] = [
    {
      role: 'user',
      id: 'user',
      createdAt: 1,
      mode: 'plan',
      text: 'Материал',
      attachments: attached.map((fileId) => ({ kind: 'file', fileId, name: 'brief.txt', size: 1 })),
    },
  ];
  return {
    account: { id: 'owner', role: 'user' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    messages: () => messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
}

describe('toolkit core', () => {
  it('offers search only when this chat has a file and keeps calculate in every mode', () => {
    const bare = chatTools({} as GenerationService, { ...scope([]), mode: 'chat' });
    expect(bare.map((tool) => tool.name)).not.toContain('search_materials');
    expect(bare.map((tool) => tool.name)).toContain('calculate');
    const withFile = chatTools({} as GenerationService, scope([FILE]));
    expect(withFile.map((tool) => tool.name)).toContain('search_materials');
    expect(withFile.map((tool) => tool.name)).toContain('inspect_template_layout');
  });

  it('refuses a file that is not attached before querying storage', async () => {
    const query = vi.fn();
    const tools = chatTools({ pool: { query } } as unknown as GenerationService, scope([FILE]));
    const context = {
      callId: 'c',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    };
    await expect(
      tools
        .find((tool) => tool.name === 'search_materials')
        ?.run({ fileId: FOREIGN, query: 'Бюджет' }, context),
    ).rejects.toThrow(/attached/);
    await expect(
      tools.find((tool) => tool.name === 'read_file')?.run({ fileId: FOREIGN }, context),
    ).rejects.toThrow(/attached/);
    await expect(
      tools
        .find((tool) => tool.name === 'search_materials')
        ?.run({ fileId: FILE, query: 'x'.repeat(201) }, context),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns the search helper output and does not repeat the same page', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toolkit-core-'));
    directories.push(directory);
    const path = join(directory, 'brief.txt');
    await writeFile(path, 'Бюджет: 25 млн');
    const query = vi.fn(async () => ({ rows: [{ file_name: 'brief.txt', storage_path: path }] }));
    const tool = chatTools({ pool: { query } } as unknown as GenerationService, scope([FILE])).find(
      (item) => item.name === 'search_materials',
    );
    const context = {
      callId: 'c',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    };
    const first = await tool?.run({ fileId: FILE, query: 'бюджет' }, context);
    const second = await tool?.run({ fileId: FILE, query: 'бюджет' }, context);
    expect(first?.output).toMatchObject({ sourceId: FILE, matches: [{ quote: 'Бюджет' }] });
    expect(second?.output).toEqual(first?.output);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('stops after eight distinct searches before another storage read', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const tool = chatTools({ pool: { query } } as unknown as GenerationService, scope([FILE])).find(
      (item) => item.name === 'search_materials',
    );
    const context = {
      callId: 'c',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    };
    for (let index = 0; index < 8; index += 1) {
      await expect(tool?.run({ fileId: FILE, query: 'q' + index }, context)).rejects.toThrow(
        /available/,
      );
    }
    await expect(tool?.run({ fileId: FILE, query: 'ninth' }, context)).rejects.toThrow(/limit/);
    expect(query).toHaveBeenCalledTimes(8);
  });

  it('calculates from the shared schema in every mode', async () => {
    const tool = chatTools({} as GenerationService, { ...scope([]), mode: 'auto' }).find(
      (item) => item.name === 'calculate',
    );
    const result = await tool?.run(
      {
        operation: 'percentage_change',
        values: [
          { value: 18, unit: 'шт' },
          { value: 11, unit: 'шт' },
        ],
      },
      { callId: 'c', signal: new AbortController().signal, show: () => 0, update: () => undefined },
    );
    expect(result?.output).toMatchObject({ direction: 'decrease', result: { unit: '%' } });
    await expect(
      tool?.run(
        {
          operation: 'sum',
          values: [
            { value: 1, unit: 'кг' },
            { value: 2, unit: 'м' },
          ],
        },
        {
          callId: 'c',
          signal: new AbortController().signal,
          show: () => 0,
          update: () => undefined,
        },
      ),
    ).rejects.toThrow(/единице/);
  });

  it('prepares a template once and falls back to profile pattern ids', async () => {
    const parsed = profile();
    const patternId = parsed.compositions[0]?.patternId;
    if (!patternId) throw new Error('fixture has no pattern');
    const context = {
      callId: 'c',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    };
    const ready = vi.fn(async () => ({
      rows: [{ id: TEMPLATE, name: 'Template', profile: { generation: parsed, index: null } }],
    }));
    const described = await chatTools(
      { pool: { query: ready }, prepare: vi.fn() } as unknown as GenerationService,
      scope([]),
    )
      .find((tool) => tool.name === 'describe_template')
      ?.run({ templateId: TEMPLATE }, context);
    expect(described?.output).toMatchObject({ layouts: [{ patternId }] });
    expect(described?.output).not.toMatchObject({ layouts: [{ kind: expect.anything() }] });
    let reads = 0;
    const query = vi.fn(async () => {
      reads += 1;
      if (reads === 1) return { rows: [{ id: TEMPLATE, name: 'Template', profile: null }] };
      return {
        rows: [{ id: TEMPLATE, name: 'Template', profile: { generation: parsed, index: null } }],
      };
    });
    const prepare = vi.fn(async () => undefined);
    const inspected = await chatTools(
      { pool: { query }, prepare } as unknown as GenerationService,
      scope([]),
    )
      .find((tool) => tool.name === 'inspect_template_layout')
      ?.run({ templateId: TEMPLATE, patternId, imageOffset: 0 }, context);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(inspected?.output).toMatchObject({ patternId });
  });

  async function webDispatcher(web: ChatWebDependency, signal = new AbortController().signal) {
    const tools = chatTools(
      {} as GenerationService,
      { ...scope([]), mode: 'chat' },
      undefined,
      web,
    );
    const agent = await loadChatAgent(REGISTRY);
    const dispatcher = new ChatToolDispatcher({
      tools,
      specs: toolSpecs(agent, tools),
      mode: 'chat',
    });
    const context: ToolContext = { callId: 'web', signal, show: () => 0, update: () => undefined };
    return { dispatcher, context };
  }

  it('returns the search and fetch helpers unchanged and passes the signal', async () => {
    const signal = new AbortController().signal;
    const answer: WebSearchAnswer = {
      query: 'тариф',
      results: [],
      searchedAt: '2026-10-18T00:00:00.000Z',
      unresponsiveEngines: [],
      complete: true,
      trust: 'search-results-not-evidence',
    };
    const page: WebSourcePage = {
      requestedUrl: 'https://example.com/a',
      url: 'https://example.com/a',
      title: null,
      text: 'страница',
      fetchedAt: '2026-10-18T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      offset: 0,
      nextOffset: null,
      truncated: false,
      trust: 'unverified',
    };
    const search = vi.fn(async () => answer);
    const fetchSource = vi.fn(async () => page);
    const { dispatcher, context } = await webDispatcher(
      { search: { search }, fetchSource },
      signal,
    );
    const searched = await dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: ' тариф ', limit: 3 }),
      context,
    );
    const fetched = await dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: ' https://example.com/a ', offset: 0, maxChars: 100 }),
      context,
    );
    expect(searched.failed).not.toBe(true);
    expect(searched.output).toBe(answer);
    expect(fetched.output).toBe(page);
    expect(search).toHaveBeenCalledWith('тариф', signal, 3);
    expect(fetchSource).toHaveBeenCalledWith('https://example.com/a', signal, {
      offset: 0,
      maxChars: 100,
    });
  });

  it('keeps fetch and calculate when search is disabled or WEB_SEARCH_URL is invalid', async () => {
    const disabled = chatTools({} as GenerationService, { ...scope([]), mode: 'chat' }, undefined, {
      search: null,
      fetchSource: vi.fn(),
    });
    expect(disabled.map((tool) => tool.name)).not.toContain('search_web');
    expect(disabled.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['fetch_source', 'calculate']),
    );
    const { dispatcher, context } = await webDispatcher({ search: null, fetchSource: vi.fn() });
    const refused = await dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'тариф' }),
      context,
    );
    expect(refused).toMatchObject({ failed: true, output: { code: 'tool_not_allowed' } });
    const previous = process.env.WEB_SEARCH_URL;
    process.env.WEB_SEARCH_URL = 'not a url';
    try {
      const names = chatTools({} as GenerationService, { ...scope([]), mode: 'chat' }).map(
        (tool) => tool.name,
      );
      expect(names).not.toContain('search_web');
      expect(names).toEqual(expect.arrayContaining(['fetch_source', 'calculate']));
    } finally {
      if (previous === undefined) delete process.env.WEB_SEARCH_URL;
      else process.env.WEB_SEARCH_URL = previous;
    }
  });

  it('spends eight shared calls on failures and serves a repeated success from cache', async () => {
    const search = vi.fn(async () => {
      throw new Error('engine down');
    });
    const fetchSource = vi.fn(async () => {
      throw new Error('page down');
    });
    const { dispatcher, context } = await webDispatcher({ search: { search }, fetchSource });
    for (let index = 0; index < 7; index += 1) {
      const failed = await dispatcher.dispatch(
        'search_web',
        JSON.stringify({ query: 'q' + String(index) }),
        context,
      );
      expect(failed).toMatchObject({ failed: true, output: { error: 'engine down' } });
    }
    const page = await dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: 'https://example.com/down' }),
      context,
    );
    expect(page).toMatchObject({ failed: true, output: { error: 'page down' } });
    const ninth = await dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'ninth' }),
      context,
    );
    expect(ninth).toMatchObject({
      failed: true,
      output: { error: expect.stringMatching(/limit/) },
    });
    expect(search).toHaveBeenCalledTimes(7);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    const cachedAnswer: WebSearchAnswer = {
      query: 'ok',
      results: [],
      searchedAt: '2026-10-18T00:00:00.000Z',
      unresponsiveEngines: [],
      complete: false,
      trust: 'search-results-not-evidence',
    };
    const cachedSearch = vi.fn(async () => cachedAnswer);
    const cached = await webDispatcher({ search: { search: cachedSearch }, fetchSource: vi.fn() });
    const first = await cached.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'ok' }),
      cached.context,
    );
    const second = await cached.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'ok' }),
      cached.context,
    );
    expect(second.output).toBe(first.output);
    expect(cachedSearch).toHaveBeenCalledTimes(1);
  });

  it('does not call the helper when the turn is already aborted or the arguments are invalid', async () => {
    const controller = new AbortController();
    controller.abort();
    const search = vi.fn();
    const fetchSource = vi.fn();
    const aborted = await webDispatcher({ search: { search }, fetchSource }, controller.signal);
    await expect(
      aborted.dispatcher.dispatch(
        'search_web',
        JSON.stringify({ query: 'тариф' }),
        aborted.context,
      ),
    ).rejects.toThrow(/abort/i);
    expect(search).not.toHaveBeenCalled();
    const { dispatcher, context } = await webDispatcher({ search: { search }, fetchSource });
    const cases = [
      ['search_web', { query: '   ' }],
      ['search_web', { query: 'q'.repeat(301) }],
      ['fetch_source', { url: 'u'.repeat(2049) }],
      ['fetch_source', { url: 'https://example.com', expectedContentHash: 'abc' }],
    ] as const;
    for (const [name, input] of cases) {
      const result = await dispatcher.dispatch(name, JSON.stringify(input), context);
      expect(result).toMatchObject({ failed: true, output: { code: 'invalid_arguments' } });
    }
    expect(search).not.toHaveBeenCalled();
    expect(fetchSource).not.toHaveBeenCalled();
  });
});
