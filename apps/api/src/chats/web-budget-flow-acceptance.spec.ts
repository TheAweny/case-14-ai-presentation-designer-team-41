import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MaterialResearchResult, MaterialResearchSource } from '@lct/contracts';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import type { AssetSearchAnswer } from './asset-search.js';
import { chatTools, type ChatToolScope, type ChatWebDependency } from './chat-tools.js';
import { webSourceId } from './web-research.js';

const REGISTRY = join(import.meta.dirname, '../../../../registry/agents');
const FETCHED_AT = '2026-10-18T00:00:00.000Z';
const HASH = 'a'.repeat(64);
const INSTRUCTIONS = 'b'.repeat(64);

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

function toolContext(signal = new AbortController().signal, callId = 'web'): ToolContext {
  return { callId, signal, show: () => 0, update: () => undefined };
}

function quoteFor(index: number, slot: number): string {
  return 'факт ' + String(index) + '-' + String(slot);
}

function urlFor(kind: string, index: number): string {
  return 'https://example.org/' + kind + '/' + String(index);
}

function searchHit(url: string, title: string, snippet: string) {
  return { url, title, snippet, publishedAt: null };
}

function searchAnswer(query: string, results: ReadonlyArray<ReturnType<typeof searchHit>>) {
  return {
    query,
    results: [...results],
    searchedAt: FETCHED_AT,
    unresponsiveEngines: [] as string[],
    complete: true,
    trust: 'search-results-not-evidence' as const,
  };
}

function page(url: string, text: string) {
  return {
    requestedUrl: url,
    url,
    title: url,
    text,
    fetchedAt: FETCHED_AT,
    contentHash: HASH,
    offset: 0,
    nextOffset: null,
    truncated: false,
    trust: 'unverified' as const,
  };
}

function assetAnswer(query: string, index: number): AssetSearchAnswer {
  return {
    query,
    assets: [
      {
        url: urlFor('asset-page', index),
        imageUrl: urlFor('asset-image', index) + '.png',
        title: 'Схема ' + String(index),
        license: 'unknown',
      },
    ],
    searchedAt: FETCHED_AT,
    complete: true,
    trust: 'search-results-not-evidence',
  };
}

function childFromSources(sources: readonly MaterialResearchSource[]): MaterialResearchResult {
  const evidence = sources.slice(0, 3).map((source) => {
    const quote = source.text.split('\n')[0] ?? source.text;
    const start = source.text.indexOf(quote);
    if (start < 0) throw new Error('fixture quote missing from source text');
    return {
      sourceId: source.sourceId,
      name: source.name,
      quote,
      start: (source.offset ?? 0) + start,
      support: 'unverified' as const,
    };
  });
  return {
    outputTruncated: false,
    summary: evidence.map((item) => item.quote).join('; '),
    evidence,
    openQuestions: [],
    coverage: sources.slice(0, 3).map((source) => ({
      sourceId: source.sourceId,
      offset: source.offset ?? 0,
      readChars: source.text.length,
      truncated: source.truncated,
      nextOffset: null,
    })),
    manifest: {
      agentId: 'web-researcher',
      agentVersion: '1.0.0',
      instructionsSha256: INSTRUCTIONS,
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
  return { tools, dispatcher: wrapped };
}

function expectBudgetExhausted(
  result: { failed?: boolean; output: unknown },
  operation: 'search' | 'fetch' | 'images' | 'research',
) {
  expect(result.failed).toBe(true);
  expect(result.output).toMatchObject({
    code: 'web_budget_exhausted',
    canContinue: true,
    operation,
  });
}

describe('web budget flow through chat tools', () => {
  it('lets two research questions spend independent search, fetch and asset quotas, then cache without network', async () => {
    const search = vi.fn(async (query: string) => {
      const index = query.includes('второй') ? 2 : 1;
      return searchAnswer(query, [
        searchHit(urlFor('r', index * 10 + 1), 'Источник A', 'сниппет не факт'),
        searchHit(urlFor('r', index * 10 + 2), 'Источник B', 'сниппет не факт'),
        searchHit(urlFor('r', index * 10 + 3), 'Источник C', 'сниппет не факт'),
      ]);
    });
    const fetchSource = vi.fn(async (url: string) => {
      const n = Number(url.slice(url.lastIndexOf('/') + 1));
      const slot = n % 10;
      const group = Math.floor(n / 10);
      return page(
        url,
        quoteFor(group, slot) + String.fromCharCode(10) + 'контекст страницы ' + url,
      );
    });
    const run = vi.fn(async (_question: string, sources: readonly MaterialResearchSource[]) => {
      expect(sources).toHaveLength(3);
      expect(new Set(sources.map((item) => item.sourceId)).size).toBe(3);
      for (const source of sources) {
        expect(source.sourceId).toBe(webSourceId(source.name));
      }
      return childFromSources(sources);
    });
    const assets = { search: vi.fn(async (query: string) => assetAnswer(query, 1)) };
    const ready = await dispatcher({
      search: { search },
      fetchSource,
      research: { run },
      assets,
    });

    const first = await ready.dispatcher.dispatch(
      'research_topic',
      JSON.stringify({ question: ' первый вопрос ' }),
      toolContext(new AbortController().signal, 'r1'),
    );
    expect(first.failed).not.toBe(true);
    expect(first.output).toMatchObject({
      evidence: [
        { url: urlFor('r', 11), quote: quoteFor(1, 1), support: 'unverified' },
        { url: urlFor('r', 12), quote: quoteFor(1, 2), support: 'unverified' },
        { url: urlFor('r', 13), quote: quoteFor(1, 3), support: 'unverified' },
      ],
    });
    expect((first.output as { evidence: unknown[] }).evidence).toHaveLength(3);

    const second = await ready.dispatcher.dispatch(
      'research_topic',
      JSON.stringify({ question: 'второй вопрос' }),
      toolContext(new AbortController().signal, 'r2'),
    );
    expect(second.failed).not.toBe(true);
    expect(second.output).toMatchObject({
      evidence: [
        { url: urlFor('r', 21), quote: quoteFor(2, 1), support: 'unverified' },
        { url: urlFor('r', 22), quote: quoteFor(2, 2), support: 'unverified' },
        { url: urlFor('r', 23), quote: quoteFor(2, 3), support: 'unverified' },
      ],
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(2);
    expect(fetchSource).toHaveBeenCalledTimes(6);

    const extraSearch = await ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'прямой поиск', limit: 1 }),
      toolContext(new AbortController().signal, 's1'),
    );
    expect(extraSearch.failed).not.toBe(true);
    const extraFetch = await ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('direct', 1) }),
      toolContext(new AbortController().signal, 'f1'),
    );
    expect(extraFetch.failed).not.toBe(true);
    const extraAssets = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'схема', limit: 1 }),
      toolContext(new AbortController().signal, 'a1'),
    );
    expect(extraAssets.failed).not.toBe(true);
    expect(search).toHaveBeenCalledTimes(3);
    expect(fetchSource).toHaveBeenCalledTimes(7);
    expect(assets.search).toHaveBeenCalledTimes(1);

    const cachedResearch = await ready.dispatcher.dispatch(
      'research_topic',
      JSON.stringify({ question: 'первый вопрос' }),
      toolContext(new AbortController().signal, 'r1c'),
    );
    expect(cachedResearch.output).toEqual(first.output);
    const cachedSearch = await ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'прямой поиск', limit: 1 }),
      toolContext(new AbortController().signal, 's1c'),
    );
    expect(cachedSearch.output).toEqual(extraSearch.output);
    const cachedFetch = await ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('direct', 1) }),
      toolContext(new AbortController().signal, 'f1c'),
    );
    expect(cachedFetch.output).toEqual(extraFetch.output);
    const cachedAssets = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'схема', limit: 1 }),
      toolContext(new AbortController().signal, 'a1c'),
    );
    expect(cachedAssets.output).toEqual(extraAssets.output);
    expect(run).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenCalledTimes(3);
    expect(fetchSource).toHaveBeenCalledTimes(7);
    expect(assets.search).toHaveBeenCalledTimes(1);
  });

  it('exhausts the fetch quota independently so search and assets still succeed', async () => {
    const search = vi.fn(async (query: string) =>
      searchAnswer(query, [searchHit(urlFor('search', 1), 'Hit', 'snippet')]),
    );
    const fetchSource = vi.fn(async (url: string) => page(url, 'текст ' + url));
    const assets = { search: vi.fn(async (query: string) => assetAnswer(query, 1)) };
    const ready = await dispatcher({
      search: { search },
      fetchSource,
      assets,
    });

    for (let index = 0; index < 24; index += 1) {
      const done = await ready.dispatcher.dispatch(
        'fetch_source',
        JSON.stringify({ url: urlFor('page', index) }),
        toolContext(new AbortController().signal, 'f' + String(index)),
      );
      expect(done.failed).not.toBe(true);
    }
    expect(fetchSource).toHaveBeenCalledTimes(24);

    const blocked = await ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('page', 24) }),
      toolContext(new AbortController().signal, 'f24'),
    );
    expectBudgetExhausted(blocked, 'fetch');
    expect(fetchSource).toHaveBeenCalledTimes(24);

    const searchOk = await ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'ещё поиск', limit: 1 }),
      toolContext(new AbortController().signal, 's'),
    );
    expect(searchOk.failed).not.toBe(true);
    const assetsOk = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'ещё схема', limit: 1 }),
      toolContext(new AbortController().signal, 'a'),
    );
    expect(assetsOk.failed).not.toBe(true);
    expect(search).toHaveBeenCalledTimes(1);
    expect(assets.search).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledTimes(24);
  });

  it('counts a failed load against its own operation and does not cache it', async () => {
    const search = vi.fn(async () => {
      throw new Error('search-down');
    });
    const fetchSource = vi.fn(async () => {
      throw new Error('fetch-down');
    });
    const assets = {
      search: vi.fn(async () => {
        throw new Error('assets-down');
      }),
    };
    const ready = await dispatcher({
      search: { search },
      fetchSource,
      assets,
    });

    for (let index = 0; index < 24; index += 1) {
      const failed = await ready.dispatcher.dispatch(
        'fetch_source',
        JSON.stringify({ url: urlFor('fail-fetch', index) }),
        toolContext(new AbortController().signal, 'ff' + String(index)),
      );
      expect(failed.failed).toBe(true);
      expect(failed.output).not.toMatchObject({ code: 'web_budget_exhausted' });
    }
    expect(fetchSource).toHaveBeenCalledTimes(24);
    const blockedFetch = await ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('fail-fetch', 24) }),
      toolContext(new AbortController().signal, 'ff24'),
    );
    expectBudgetExhausted(blockedFetch, 'fetch');
    expect(fetchSource).toHaveBeenCalledTimes(24);

    for (let index = 0; index < 8; index += 1) {
      const failed = await ready.dispatcher.dispatch(
        'search_web',
        JSON.stringify({ query: 'падение поиска ' + String(index), limit: 1 }),
        toolContext(new AbortController().signal, 'fs' + String(index)),
      );
      expect(failed.failed).toBe(true);
      expect(failed.output).not.toMatchObject({ code: 'web_budget_exhausted' });
    }
    const blockedSearch = await ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'падение поиска extra', limit: 1 }),
      toolContext(new AbortController().signal, 'fs8'),
    );
    expectBudgetExhausted(blockedSearch, 'search');

    for (let index = 0; index < 4; index += 1) {
      const failed = await ready.dispatcher.dispatch(
        'search_assets',
        JSON.stringify({ query: 'падение схем ' + String(index), limit: 1 }),
        toolContext(new AbortController().signal, 'fa' + String(index)),
      );
      expect(failed.failed).toBe(true);
      expect(failed.output).not.toMatchObject({ code: 'web_budget_exhausted' });
    }
    const blockedAssets = await ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'падение схем extra', limit: 1 }),
      toolContext(new AbortController().signal, 'fa4'),
    );
    expectBudgetExhausted(blockedAssets, 'images');

    expect(search).toHaveBeenCalledTimes(8);
    expect(assets.search).toHaveBeenCalledTimes(4);
    expect(fetchSource).toHaveBeenCalledTimes(24);
  });

  it('throws on an already aborted turn without a failed tool output and without network', async () => {
    const search = vi.fn(async () => {
      throw new Error('network must not run');
    });
    const fetchSource = vi.fn(async () => {
      throw new Error('network must not run');
    });
    const assets = {
      search: vi.fn(async () => {
        throw new Error('network must not run');
      }),
    };
    const run = vi.fn(async () => {
      throw new Error('network must not run');
    });
    const ready = await dispatcher({
      search: { search },
      fetchSource,
      research: { run },
      assets,
    });
    const controller = new AbortController();
    controller.abort();
    const context = toolContext(controller.signal, 'aborted');

    await expect(
      ready.dispatcher.dispatch(
        'search_web',
        JSON.stringify({ query: 'уже отменён', limit: 1 }),
        context,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name !== 'WebBudgetError',
    );
    await expect(
      ready.dispatcher.dispatch(
        'fetch_source',
        JSON.stringify({ url: urlFor('aborted', 1) }),
        context,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name !== 'WebBudgetError',
    );
    await expect(
      ready.dispatcher.dispatch(
        'search_assets',
        JSON.stringify({ query: 'уже отменён', limit: 1 }),
        context,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name !== 'WebBudgetError',
    );
    await expect(
      ready.dispatcher.dispatch(
        'research_topic',
        JSON.stringify({ question: 'уже отменён' }),
        context,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof Error && error.name !== 'WebBudgetError',
    );

    expect(search).not.toHaveBeenCalled();
    expect(fetchSource).not.toHaveBeenCalled();
    expect(assets.search).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('coalesces concurrent duplicate web calls into one network load when the gate is shared', async () => {
    let searchStarted = 0;
    let fetchStarted = 0;
    let assetsStarted = 0;
    let releaseSearch!: () => void;
    let releaseFetch!: () => void;
    let releaseAssets!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const assetsGate = new Promise<void>((resolve) => {
      releaseAssets = resolve;
    });

    const search = vi.fn(async (query: string) => {
      searchStarted += 1;
      await searchGate;
      return searchAnswer(query, [searchHit(urlFor('dup', 1), 'Dup', 'snippet')]);
    });
    const fetchSource = vi.fn(async (url: string) => {
      fetchStarted += 1;
      await fetchGate;
      return page(url, 'duplicate page');
    });
    const assets = {
      search: vi.fn(async (query: string) => {
        assetsStarted += 1;
        await assetsGate;
        return assetAnswer(query, 3);
      }),
    };
    const ready = await dispatcher({
      search: { search },
      fetchSource,
      assets,
    });

    const searchA = ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'один ключ', limit: 2 }),
      toolContext(new AbortController().signal, 'sa'),
    );
    const searchB = ready.dispatcher.dispatch(
      'search_web',
      JSON.stringify({ query: 'один ключ', limit: 2 }),
      toolContext(new AbortController().signal, 'sb'),
    );
    await vi.waitFor(() => {
      expect(searchStarted).toBeGreaterThan(0);
    });
    expect(searchStarted).toBe(1);
    releaseSearch();
    const searches = await Promise.all([searchA, searchB]);
    expect(searches[0]?.failed).not.toBe(true);
    expect(searches[1]?.output).toEqual(searches[0]?.output);
    expect(search).toHaveBeenCalledTimes(1);

    const fetchA = ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('dup', 7) }),
      toolContext(new AbortController().signal, 'fa'),
    );
    const fetchB = ready.dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: urlFor('dup', 7) }),
      toolContext(new AbortController().signal, 'fb'),
    );
    await vi.waitFor(() => {
      expect(fetchStarted).toBeGreaterThan(0);
    });
    expect(fetchStarted).toBe(1);
    releaseFetch();
    const fetches = await Promise.all([fetchA, fetchB]);
    expect(fetches[0]?.failed).not.toBe(true);
    expect(fetches[1]?.output).toEqual(fetches[0]?.output);
    expect(fetchSource).toHaveBeenCalledTimes(1);

    const assetsA = ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'одна схема', limit: 1 }),
      toolContext(new AbortController().signal, 'aa'),
    );
    const assetsB = ready.dispatcher.dispatch(
      'search_assets',
      JSON.stringify({ query: 'одна схема', limit: 1 }),
      toolContext(new AbortController().signal, 'ab'),
    );
    await vi.waitFor(() => {
      expect(assetsStarted).toBeGreaterThan(0);
    });
    expect(assetsStarted).toBe(1);
    releaseAssets();
    const images = await Promise.all([assetsA, assetsB]);
    expect(images[0]?.failed).not.toBe(true);
    expect(images[1]?.output).toEqual(images[0]?.output);
    expect(assets.search).toHaveBeenCalledTimes(1);
  });
});
