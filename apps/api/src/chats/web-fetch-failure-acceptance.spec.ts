import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChatToolActivity } from '@lct/contracts';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope, type ChatWebDependency } from './chat-tools.js';
import { fetchWebSource, WebSourceError, type WebSourcePage } from './web-source.js';
import { researchWebTopic } from './web-research.js';

const scope: ChatToolScope = {
  account: { id: 'owner', role: 'user' } as ChatToolScope['account'],
  chatId: 'chat',
  projectId: null,
  mode: 'chat',
  model: null,
  messages: () => [],
  updatePart: () => undefined,
  addDecks: () => undefined,
};
const context = (signal = new AbortController().signal): ToolContext => ({
  callId: 'fetch',
  signal,
  show: () => 0,
  update: () => undefined,
});
function page(url: string): WebSourcePage {
  return {
    requestedUrl: url,
    url,
    title: 'Readable report',
    text: 'Public report text',
    fetchedAt: '2026-10-18T00:00:00Z',
    contentHash: 'a'.repeat(64),
    offset: 0,
    nextOffset: null,
    truncated: false,
    trust: 'unverified',
  };
}
function tools(fetchSource: ChatWebDependency['fetchSource']) {
  return chatTools({} as GenerationService, scope, undefined, { search: null, fetchSource });
}
function reader(fetchSource: ChatWebDependency['fetchSource']) {
  const tool = tools(fetchSource).find((item) => item.name === 'fetch_source');
  if (!tool) throw new Error('fetch_source missing');
  return tool;
}

describe('independent fetch failure acceptance', () => {
  it('redacts research errors while retaining only validated failure fields', async () => {
    const known = {
      code: 'web_source_failed',
      error: 'web_http_403',
      kind: 'http',
      status: 403,
      retryable: false,
      action: 'try_another_source',
    };
    const cases = [
      {
        error: new WebSourceError('http', 'PRIVATE_BODY', 403),
        expected: { message: 'web_http_403', status: 403, retryable: false },
      },
      {
        error: Object.assign(new Error('PRIVATE_BODY'), {
          output: { ...known, body: 'PRIVATE_BODY', headers: 'PRIVATE_KEY' },
        }),
        expected: { message: 'web_http_403', status: 403, retryable: false },
      },
      { error: new Error('PRIVATE_BODY'), expected: { message: 'fetch-failed' } },
      {
        error: Object.assign(new Error('PRIVATE_BODY'), {
          output: { ...known, status: '403', action: 'PRIVATE_COMMAND' },
        }),
        expected: { message: 'fetch-failed' },
      },
    ];
    for (const item of cases) {
      const result = await researchWebTopic(
        'report',
        {
          search: async (query) => ({
            query,
            results: [
              {
                url: 'https://example.org/report',
                title: 'Report',
                snippet: '',
                publishedAt: null,
              },
            ],
            searchedAt: '2026-10-18T00:00:00Z',
            complete: true,
            unresponsiveEngines: [],
            trust: 'search-results-not-evidence',
          }),
          fetch: async () => {
            throw item.error;
          },
          run: vi.fn(),
        },
        context().signal,
      );
      expect(result.failures[0]).toMatchObject(item.expected);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_');
      expect(result.evidence).toEqual([]);
    }
    for (const error of [
      new WebSourceError('aborted'),
      new DOMException('stopped', 'AbortError'),
    ]) {
      await expect(
        researchWebTopic(
          'report',
          {
            search: async (query) => ({
              query,
              results: [
                {
                  url: 'https://example.org/report',
                  title: 'Report',
                  snippet: '',
                  publishedAt: null,
                },
              ],
              searchedAt: '2026-10-18T00:00:00Z',
              complete: true,
              unresponsiveEngines: [],
              trust: 'search-results-not-evidence',
            }),
            fetch: async () => {
              throw error;
            },
            run: vi.fn(),
          },
          context().signal,
        ),
      ).rejects.toMatchObject({ kind: 'aborted' });
    }
  });

  it('does not reuse a clean denial for invalid credentials or a nonstandard port', async () => {
    const fetchSource = vi.fn(async (url: string, signal: AbortSignal) => {
      return fetchWebSource(url, signal, {
        resolve: async () => ['8.8.8.8'],
        transport: {
          request: async () => ({
            status: 403,
            headers: {},
            body: (async function* () {
              yield Buffer.from('Denied');
            })(),
          }),
        },
      });
    });
    const fetch = reader(fetchSource);
    await fetch.run({ url: 'https://example.org/report' }, context());
    for (const url of [
      'https://user:password@example.org/report',
      'https://example.org:8443/report',
    ]) {
      const result = await fetch.run({ url }, context());
      expect(result.output).toMatchObject({ error: 'web_invalid_url', retryable: false });
    }
    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it('redacts an unexpected transport error but preserves AbortError', async () => {
    const fetch = reader(async () => {
      throw new Error('PRIVATE_KEY response body');
    });
    const result = await fetch.run({ url: 'https://example.org/report' }, context());
    expect(result.failed).toBe(true);
    expect(result.output).toMatchObject({ error: 'web_unreachable' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_KEY');
    const abort = reader(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(abort.run({ url: 'https://example.org/report' }, context())).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });

  it('shares permanent denials with delegated research without losing the HTTP reason', async () => {
    const url = 'https://example.org/denied';
    const fetchSource = vi.fn(async () => {
      throw new WebSourceError('http', 'PRIVATE_BODY', 403);
    });
    const available = chatTools({} as GenerationService, scope, undefined, {
      fetchSource,
      search: {
        search: async (query) => ({
          query,
          results: [{ url, title: 'Report', snippet: 'Search preview', publishedAt: null }],
          searchedAt: '2026-10-18T00:00:00Z',
          complete: true,
          unresponsiveEngines: [],
          trust: 'search-results-not-evidence',
        }),
      },
      research: { run: vi.fn() },
    });
    const fetch = available.find((tool) => tool.name === 'fetch_source');
    const research = available.find((tool) => tool.name === 'research_topic');
    if (!fetch || !research) throw new Error('Missing web tools');
    await fetch.run({ url }, context());
    const events: ChatToolActivity[] = [];
    const result = await research.run({ question: 'Find the original report' }, {
      ...context(),
      activity: (event: ChatToolActivity) => events.push(event),
    } as ToolContext);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(result.output).toMatchObject({
      failures: [{ message: 'web_http_403', status: 403, retryable: false }],
    });
    expect(
      events.find((event) => event.name === 'fetch_source' && event.status === 'failed')?.error,
    ).toBe('web_http_403');
    expect(JSON.stringify({ result, events })).not.toContain('PRIVATE_BODY');
  });

  it('preserves a real HTTP denial through the dispatcher without provider text', async () => {
    const fetchSource = vi.fn(async () => {
      throw new WebSourceError('http', 'PRIVATE_BODY Authorization=PRIVATE_KEY', 403);
    });
    const available = tools(fetchSource);
    const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
    const dispatcher = new ChatToolDispatcher({
      tools: available,
      specs: toolSpecs(agent, available),
      mode: 'chat',
    });
    const result = await dispatcher.dispatch(
      'fetch_source',
      JSON.stringify({ url: 'https://example.org/report' }),
      context(),
    );
    expect(result.failed).toBe(true);
    expect(result.output).toMatchObject({ error: 'web_http_403', status: 403, retryable: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('does not spend the turn on repeated denied URLs, but keeps other pages readable', async () => {
    const fetchSource = vi.fn(async (url: string) => {
      if (url.includes('/denied')) throw new WebSourceError('http', 'http', 403);
      return page(url);
    });
    const fetch = reader(fetchSource);
    for (let index = 0; index < 30; index += 1) {
      const result = await fetch.run(
        { url: 'https://example.org/denied#section-' + String(index), offset: index * 10 },
        context(),
      );
      expect(result.failed).toBe(true);
      expect(result.output).toMatchObject({ error: 'web_http_403' });
    }
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect((await fetch.run({ url: 'https://example.org/healthy' }, context())).failed).not.toBe(
      true,
    );
    expect(fetchSource).toHaveBeenCalledTimes(2);
    await reader(fetchSource).run({ url: 'https://example.org/denied' }, context());
    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it('does not cache a temporary server error or poison an entire domain', async () => {
    let attempts = 0;
    const fetchSource = vi.fn(async (url: string) => {
      if (url.endsWith('/missing')) throw new WebSourceError('http', 'http', 404);
      if (url.endsWith('/transient') && attempts++ === 0)
        throw new WebSourceError('http', 'http', 503);
      return page(url);
    });
    const fetch = reader(fetchSource);
    const first = await fetch.run({ url: 'https://example.org/transient' }, context());
    expect(first.output).toMatchObject({ error: 'web_http_5xx', status: 503, retryable: true });
    expect((await fetch.run({ url: 'https://example.org/transient' }, context())).failed).not.toBe(
      true,
    );
    expect((await fetch.run({ url: 'https://example.org/missing' }, context())).failed).toBe(true);
    expect((await fetch.run({ url: 'https://example.org/published' }, context())).failed).not.toBe(
      true,
    );
    expect(fetchSource).toHaveBeenCalledTimes(4);
  });

  it('keeps distinct query resources separate and honours cancellation before a cached denial', async () => {
    const fetchSource = vi.fn(async () => {
      throw new WebSourceError('http', 'http', 401);
    });
    const fetch = reader(fetchSource);
    await fetch.run({ url: 'https://example.org/report?id=1' }, context());
    await fetch.run({ url: 'https://example.org/report?id=2' }, context());
    expect(fetchSource).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    controller.abort(new Error('User stopped'));
    await expect(
      fetch.run({ url: 'https://example.org/report?id=1' }, context(controller.signal)),
    ).rejects.toThrow('User stopped');
    expect(fetchSource).toHaveBeenCalledTimes(2);
  });
});
