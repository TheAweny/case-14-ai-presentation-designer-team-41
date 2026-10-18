import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialResearchResult, MaterialResearchSource } from '@lct/contracts';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope, type ChatWebDependency } from './chat-tools.js';
import { webSourceId } from './web-research.js';
import type { AssetSearchAnswer } from './asset-search.js';

const REGISTRY = join(import.meta.dirname, '../../../../registry/agents');
const URL = 'https://example.org/report';
const QUOTE = 'бюджет 9 млн';

function scope(): ChatToolScope {
  return {
    account: { id: 'owner', role: 'user' } as ChatToolScope['account'],
    chatId: 'chat',
    projectId: null,
    mode: 'chat',
    model: null,
    messages: () => [],
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
}

function child(sources: readonly MaterialResearchSource[]): MaterialResearchResult {
  const source = sources[0];
  if (!source) throw new Error('missing source');
  return {
    outputTruncated: false,
    summary: QUOTE,
    evidence: [
      {
        sourceId: source.sourceId,
        name: source.name,
        quote: QUOTE,
        start: source.text.indexOf(QUOTE),
        support: 'unverified',
      },
    ],
    openQuestions: [],
    coverage: [],
    manifest: {
      agentId: 'web-researcher',
      agentVersion: '1.0.0',
      instructionsSha256: 'b'.repeat(64),
      model: 'assistant-default',
      modelRevision: null,
      seed: null,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
}

async function dispatcher(web: ChatWebDependency) {
  const tools = chatTools({} as GenerationService, scope(), undefined, web);
  const agent = await loadChatAgent(REGISTRY);
  const wrapped = new ChatToolDispatcher({ tools, specs: toolSpecs(agent, tools), mode: 'chat' });
  const context: ToolContext = {
    callId: 'research',
    signal: new AbortController().signal,
    show: () => 0,
    update: () => undefined,
  };
  return { tools, dispatcher: wrapped, context };
}

describe('research_topic and search_assets', () => {
  it('shares the web budget and the default fetch cache, and stops before a third research searches', async () => {
    const search = vi.fn(async (query: string) => ({
      query,
      results: [{ url: URL, title: 'Отчёт', snippet: 'не факт', publishedAt: null }],
      searchedAt: '2026-10-18T00:00:00.000Z',
      unresponsiveEngines: [],
      complete: true,
      trust: 'search-results-not-evidence' as const,
    }));
    const fetchSource = vi.fn(async (url: string) => ({
      requestedUrl: url,
      url,
      title: 'Отчёт',
      text: QUOTE,
      fetchedAt: '2026-10-18T00:00:00.000Z',
      contentHash: 'a'.repeat(64),
      offset: 0,
      nextOffset: null,
      truncated: false,
      trust: 'unverified' as const,
    }));
    const run = vi.fn(async (_question: string, sources: readonly MaterialResearchSource[]) =>
      child(sources),
    );
    const { dispatcher: tools } = await dispatcher({
      search: { search },
      fetchSource,
      research: { run },
    });
    for (let index = 0; index < 6; index += 1) {
      const done = await tools.dispatch(
        'search_web',
        JSON.stringify({ query: 'q' + String(index), limit: 1 }),
        {
          callId: 's',
          signal: new AbortController().signal,
          show: () => 0,
          update: () => undefined,
        },
      );
      expect(done.failed).not.toBe(true);
    }
    const first = await tools.dispatch('research_topic', JSON.stringify({ question: ' бюджет ' }), {
      callId: 'r1',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    });
    expect(first.failed).not.toBe(true);
    expect(first.output).toMatchObject({
      evidence: [{ url: URL, quote: QUOTE, support: 'unverified' }],
    });
    expect(search).toHaveBeenCalledWith('бюджет', expect.any(AbortSignal), 3);
    const repeated = await tools.dispatch(
      'research_topic',
      JSON.stringify({ question: 'бюджет' }),
      {
        callId: 'r1b',
        signal: new AbortController().signal,
        show: () => 0,
        update: () => undefined,
      },
    );
    expect(repeated.output).toEqual(first.output);
    expect(run).toHaveBeenCalledTimes(1);
    const fetched = await tools.dispatch('fetch_source', JSON.stringify({ url: URL }), {
      callId: 'f',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    });
    expect(fetched.failed).not.toBe(true);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    const blocked = await tools.dispatch('search_web', JSON.stringify({ query: 'ещё' }), {
      callId: 's2',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    });
    expect(blocked).toMatchObject({
      failed: true,
      output: { error: expect.stringMatching(/limit/) },
    });
    expect(search).toHaveBeenCalledTimes(7);
  });

  it('refuses a third new question before search and does not offer a child when research is off', async () => {
    const search = vi.fn(async (query: string) => ({
      query,
      results: [{ url: URL, title: 'Отчёт', snippet: 'не факт', publishedAt: null }],
      searchedAt: '2026-10-18T00:00:00.000Z',
      unresponsiveEngines: [],
      complete: true,
      trust: 'search-results-not-evidence' as const,
    }));
    const fetchSource = vi.fn(async (url: string) => ({
      requestedUrl: url,
      url,
      title: null,
      text: QUOTE,
      fetchedAt: '2026-10-18T00:00:00.000Z',
      contentHash: 'c'.repeat(64),
      offset: 0,
      nextOffset: null,
      truncated: false,
      trust: 'unverified' as const,
    }));
    const run = vi.fn(async (_question: string, sources: readonly MaterialResearchSource[]) =>
      child(sources),
    );
    const ready = await dispatcher({ search: { search }, fetchSource, research: { run } });
    const context = ready.context;
    expect(
      (
        await ready.dispatcher.dispatch(
          'research_topic',
          JSON.stringify({ question: 'первый' }),
          context,
        )
      ).failed,
    ).not.toBe(true);
    expect(
      (
        await ready.dispatcher.dispatch(
          'research_topic',
          JSON.stringify({ question: 'второй' }),
          context,
        )
      ).failed,
    ).not.toBe(true);
    const calls = search.mock.calls.length;
    const third = await ready.dispatcher.dispatch(
      'research_topic',
      JSON.stringify({ question: 'третий' }),
      context,
    );
    expect(third).toMatchObject({
      failed: true,
      output: { error: expect.stringMatching(/limit/) },
    });
    expect(search).toHaveBeenCalledTimes(calls);
    expect(run).toHaveBeenCalledTimes(2);
    expect(webSourceId(URL)).toMatch(/^[0-9a-f-]{36}$/);

    const disabled = chatTools({} as GenerationService, scope(), undefined, {
      search: { search },
      fetchSource,
    });
    expect(disabled.map((tool) => tool.name)).not.toContain('research_topic');
    const closed = await dispatcher({ search: { search }, fetchSource });
    const refused = await closed.dispatcher.dispatch(
      'research_topic',
      JSON.stringify({ question: 'первый' }),
      closed.context,
    );
    expect(refused).toMatchObject({ failed: true, output: { code: 'tool_not_allowed' } });
    const noSearch = chatTools({} as GenerationService, scope(), undefined, {
      search: null,
      fetchSource,
      research: { run },
    });
    expect(noSearch.map((tool) => tool.name)).not.toContain('research_topic');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('offers image search only when configured and keeps an unknown license', async () => {
    const previous = process.env.WEB_SEARCH_URL;
    delete process.env.WEB_SEARCH_URL;
    try {
      const bare = chatTools({} as GenerationService, scope(), undefined, {
        search: { search: vi.fn() },
        fetchSource: vi.fn(),
      });
      expect(bare.map((tool) => tool.name)).not.toContain('search_assets');
    } finally {
      if (previous === undefined) delete process.env.WEB_SEARCH_URL;
      else process.env.WEB_SEARCH_URL = previous;
    }

    const answer: AssetSearchAnswer = {
      query: 'схема',
      assets: [
        { url: URL, imageUrl: 'https://cdn.example.org/a.png', title: 'Схема', license: 'unknown' },
      ],
      searchedAt: '2026-10-18T00:00:00.000Z',
      complete: true,
      trust: 'search-results-not-evidence',
    };
    const assets = { search: vi.fn(async () => answer) };
    const ready = await dispatcher({
      search: { search: vi.fn() },
      fetchSource: vi.fn(),
      assets,
    });
    const found = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: ' схема ', limit: 1 }),
      ready.context,
    );
    expect(found.output).toBe(answer);
    expect(assets.search).toHaveBeenCalledWith('схема', ready.context.signal, 1);
    const again = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'схема', limit: 1 }),
      ready.context,
    );
    expect(again.output).toBe(answer);
    expect(assets.search).toHaveBeenCalledTimes(1);
    const invalid = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'схема', limit: 6 }),
      ready.context,
    );
    expect(invalid).toMatchObject({ failed: true, output: { code: 'invalid_arguments' } });

    process.env.WEB_SEARCH_URL = 'http://127.0.0.1:9/';
    try {
      const fromEnv = chatTools({} as GenerationService, scope(), undefined, {
        search: { search: vi.fn() },
        fetchSource: vi.fn(),
      });
      expect(fromEnv.map((tool) => tool.name)).toContain('search_assets');
    } finally {
      if (previous === undefined) delete process.env.WEB_SEARCH_URL;
      else process.env.WEB_SEARCH_URL = previous;
    }
  });
});
