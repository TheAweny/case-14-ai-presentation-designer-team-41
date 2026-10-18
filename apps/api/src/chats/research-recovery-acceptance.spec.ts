import { describe, expect, it, vi } from 'vitest';
import type { ChatToolActivity } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

describe('independent research recovery acceptance', () => {
  it('lets the parent reuse all fetched pages after a truncated child without repeating search', async () => {
    const urls = ['https://example.org/a', 'https://example.org/b', 'https://example.org/c'];
    const search = vi.fn(async (query: string) => ({
      query,
      results: urls.map((url) => ({
        url,
        title: 'Report',
        snippet: 'Not evidence',
        publishedAt: null,
      })),
      searchedAt: '2026-10-18T00:00:00Z',
      complete: true,
      unresponsiveEngines: [],
      trust: 'search-results-not-evidence' as const,
    }));
    const fetchSource = vi.fn(async (url: string) => ({
      requestedUrl: url,
      url,
      title: 'Report',
      text: 'Public page ' + url,
      fetchedAt: '2026-10-18T00:00:00Z',
      contentHash: 'a'.repeat(64),
      offset: 0,
      truncated: false,
      nextOffset: null,
      trust: 'unverified' as const,
    }));
    const run = vi.fn(async () => {
      throw Object.assign(new Error('PRIVATE_PROVIDER_BODY'), {
        kind: 'incomplete',
        reason: 'length',
      });
    });
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
    const events: ChatToolActivity[] = [];
    const context: ToolContext = {
      callId: 'research',
      signal: AbortSignal.timeout(3000),
      show: () => 0,
      update: () => undefined,
      activity: (event) => events.push(event),
    };
    const tools = chatTools({} as GenerationService, scope, undefined, {
      search: { search },
      fetchSource,
      research: { run },
    });
    const research = tools.find((tool) => tool.name === 'research_topic');
    const read = tools.find((tool) => tool.name === 'fetch_source');
    if (!research || !read) throw new Error('Missing research tools');
    const first = await research.run({ question: 'Find the public reports' }, context);
    expect(first.failed).not.toBe(true);
    expect(first.output).toMatchObject({
      evidence: [],
      manifest: null,
      coverage: urls.map((url) => ({ url })),
    });
    expect(events.filter((event) => event.kind === 'agent').map((event) => event.status)).toEqual([
      'running',
      'failed',
    ]);
    expect(JSON.stringify(first)).not.toContain('PRIVATE_');
    expect(await research.run({ question: 'Find the public reports' }, context)).toEqual(first);
    for (const url of urls) {
      const page = await read.run({ url, offset: 0, maxChars: 8000 }, context);
      expect(page.failed).not.toBe(true);
      expect(page.output).toMatchObject({ text: 'Public page ' + url, trust: 'unverified' });
    }
    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
