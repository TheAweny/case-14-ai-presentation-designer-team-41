import { describe, expect, it, vi } from 'vitest';
import type {
  ChatToolActivity,
  MaterialResearchResult,
  MaterialResearchSource,
} from '@lct/contracts';
import { researchWebTopic, WebResearchError, type WebResearchCallbacks } from './web-research.js';
import type { WebSearchAnswer, WebSearchResult } from './web-search.js';
import type { WebSourcePage } from './web-source.js';
import { withToolActivity } from './tool-activity.js';

const SECRET = 'sk-live-SECRET-999';

const STOPPED = 'Исследователь не завершил ответ; используйте прочитанные источники.';

const REASON_QUESTION = {
  length: 'Исследователь не завершил ответ: не хватило длины. Используйте прочитанные источники.',
  protocol_error:
    'Исследователь не завершил ответ: нарушен формат. Используйте прочитанные источники.',
  content_filter:
    'Исследователь не завершил ответ: сработал фильтр. Используйте прочитанные источники.',
  tool_calls:
    'Исследователь не завершил ответ: лишний вызов инструмента. Используйте прочитанные источники.',
  empty: 'Исследователь не завершил ответ: пустой результат. Используйте прочитанные источники.',
  interrupted:
    'Исследователь не завершил ответ: выполнение прервано. Используйте прочитанные источники.',
} as const;

const manifest: MaterialResearchResult['manifest'] = {
  agentId: 'web-researcher',
  agentVersion: '1.0.0',
  instructionsSha256: 'b'.repeat(64),
  model: 'assistant-default',
  modelRevision: null,
  seed: null,
  inputTokens: 3,
  outputTokens: 2,
};

describe('researchWebTopic child failure', () => {
  it('keeps three fetched pages when the child stops', async () => {
    const pages = [
      page('https://example.org/a', 'Альфа факт.', 0, false, 'a'),
      page('https://example.org/b', 'Бета продолжение.', 40, true, 'b'),
      page('https://example.org/c', 'Гамма конец.', 10, false, 'c'),
    ];
    const search = vi.fn(async () =>
      answer(
        pages.map((item) => hit(item.url)),
        true,
        ['engine-a'],
      ),
    );
    const fetchPage = vi.fn(async (url: string) => {
      const found = pages.find((item) => item.url === url);
      if (!found) throw new Error('missing page');
      return found;
    });
    const run = vi.fn(async () => {
      throw incomplete(
        'length',
        'The material researcher returned an incomplete answer. ' + SECRET,
      );
    });
    const result = await researchWebTopic(
      'что известно',
      { search, fetch: fetchPage, run },
      signal(),
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.evidence).toEqual([]);
    expect(result.summary).toBe('');
    expect(result.manifest).toBeNull();
    expect(result.complete).toBe(true);
    expect(result.searchedQuery).toBe('что известно');
    expect(result.unresponsiveEngines).toEqual(['engine-a']);
    expect(result.failures).toEqual([]);
    expect(result.openQuestions).toEqual([REASON_QUESTION.length]);
    expect(result.coverage).toEqual([
      coverage('https://example.org/a', 0, 'Альфа факт.', false, 'a'),
      coverage('https://example.org/b', 40, 'Бета продолжение.', true, 'b'),
      coverage('https://example.org/c', 10, 'Гамма конец.', false, 'c'),
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('incomplete answer');
  });

  it.each(Object.entries(REASON_QUESTION))(
    'names a %s stop without the provider message',
    async (reason, question) => {
      const result = await researchWebTopic(
        'вопрос',
        callbacks(async () => {
          throw incomplete(reason, SECRET);
        }),
        signal(),
      );
      expect(result.openQuestions).toEqual([question]);
      expect(result.evidence).toEqual([]);
      expect(result.manifest).toBeNull();
      expect(result.complete).toBe(true);
      expect(result.coverage).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(result)).not.toContain(reason);
    },
  );

  it('does not copy a generic child error or an unknown reason', async () => {
    const generic = await researchWebTopic(
      'вопрос',
      callbacks(async () => {
        throw new Error('provider ' + SECRET + ' refused');
      }),
      signal(),
    );
    expect(generic.openQuestions).toEqual([STOPPED]);
    expect(generic.evidence).toEqual([]);
    expect(generic.coverage).toHaveLength(1);
    expect(JSON.stringify(generic)).not.toContain(SECRET);

    const unknown = await researchWebTopic(
      'вопрос',
      callbacks(async () => {
        throw incomplete(SECRET, 'The material researcher returned an incomplete answer.');
      }),
      signal(),
    );
    expect(unknown.openQuestions).toEqual([STOPPED]);
    expect(JSON.stringify(unknown)).not.toContain(SECRET);
    expect(JSON.stringify(unknown)).not.toContain('incomplete answer');
  });

  it('keeps search completeness when a provider interrupt is not a caller abort', async () => {
    const result = await researchWebTopic(
      'вопрос',
      {
        search: async () => answer([hit('https://example.org/a')], false, ['engine-a']),
        fetch: async () => page('https://example.org/a', 'Факт на странице.', 0, false, 'a'),
        run: async () => {
          throw incomplete('interrupted', SECRET);
        },
      },
      signal(),
    );
    expect(result.complete).toBe(false);
    expect(result.unresponsiveEngines).toEqual(['engine-a']);
    expect(result.openQuestions).toEqual([REASON_QUESTION.interrupted]);
    expect(result.evidence).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.coverage).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('returns the pages after the nested researcher activity has failed', async () => {
    const events: ChatToolActivity[] = [];
    const controller = new AbortController();
    const run: WebResearchCallbacks['run'] = (question, sources, childSignal) =>
      withToolActivity(
        {
          callId: 'call-1',
          signal: controller.signal,
          show: () => 0,
          update: () => undefined,
          activity: (event) => events.push(event),
        },
        { kind: 'agent', name: 'web-researcher', parentId: 'call-1', detail: question },
        async () => {
          expect(sources).toHaveLength(3);
          expect(childSignal.aborted).toBe(false);
          throw incomplete('empty', SECRET);
        },
      );
    const pages = [
      page('https://example.org/a', 'Альфа.', 0, false, 'a'),
      page('https://example.org/b', 'Бета.', 8, true, 'b'),
      page('https://example.org/c', 'Гамма.', 2, false, 'c'),
    ];
    const result = await researchWebTopic(
      'что известно',
      {
        search: async () => answer(pages.map((item) => hit(item.url))),
        fetch: async (url) => {
          const found = pages.find((item) => item.url === url);
          if (!found) throw new Error('missing page');
          return found;
        },
        run,
      },
      controller.signal,
    );

    expect(events.map((event) => event.status)).toEqual(['running', 'failed']);
    expect(events[1]?.error).toBe('operation_failed');
    expect(events[1]?.kind).toBe('agent');
    expect(events[1]?.name).toBe('web-researcher');
    expect(result.evidence).toEqual([]);
    expect(result.manifest).toBeNull();
    expect(result.coverage.map((item) => item.url)).toEqual(pages.map((item) => item.url));
    expect(result.openQuestions).toEqual([REASON_QUESTION.empty]);
    expect(JSON.stringify({ events, result })).not.toContain(SECRET);
  });

  it('returns no result when the caller aborts the child', async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => {
      controller.abort();
      throw incomplete('interrupted', SECRET);
    });
    await expect(
      researchWebTopic(
        'вопрос',
        callbacks(run, [page('https://example.org/a', 'Факт.', 0, false, 'a')]),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'WebResearchError', kind: 'aborted' });
    expect(run).toHaveBeenCalledTimes(1);

    const abortError = new Error('Stopped by user');
    abortError.name = 'AbortError';
    await expect(
      researchWebTopic(
        'вопрос',
        callbacks(async () => {
          throw abortError;
        }),
        signal(),
      ),
    ).rejects.toBeInstanceOf(WebResearchError);
  });

  it('keeps a valid quote when the child finishes', async () => {
    const url = 'https://example.org/report';
    const text = 'Выручка выросла на 12 процентов за год.';
    const quote = 'выросла на 12 процентов';
    const run = vi.fn(async (_question: string, sources: readonly MaterialResearchSource[]) => {
      const source = sources[0];
      if (!source) throw new Error('missing source');
      const start = (source.offset ?? 0) + source.text.indexOf(quote);
      return child(sources, [{ sourceId: source.sourceId, quote, start }]);
    });
    const result = await researchWebTopic(
      'что с выручкой',
      callbacks(run, [page(url, text, 5, false, 'a')]),
      signal(),
    );
    expect(result.evidence).toEqual([
      {
        url,
        title: 'Страница',
        quote,
        start: 5 + text.indexOf(quote),
        fetchedAt: '2026-10-18T00:00:00.000Z',
        contentHash: 'a'.repeat(64),
        support: 'unverified',
      },
    ]);
    expect(result.summary).toBe(quote);
    expect(result.manifest).toEqual(manifest);
    expect(result.complete).toBe(true);
    expect(result.openQuestions).toEqual([]);
    expect(result.coverage).toEqual([coverage(url, 5, text, false, 'a')]);
  });
});

function incomplete(reason: string, message: string): Error {
  return Object.assign(new Error(message), { kind: 'incomplete' as const, reason });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function hit(url: string): WebSearchResult {
  return { url, title: 'Сниппет', snippet: 'не доказательство', publishedAt: null };
}

function answer(
  results: readonly WebSearchResult[],
  complete = true,
  unresponsiveEngines: readonly string[] = [],
): WebSearchAnswer {
  return {
    query: 'q',
    results,
    searchedAt: '2026-10-18T00:00:00.000Z',
    unresponsiveEngines,
    complete,
    trust: 'search-results-not-evidence',
  };
}

function page(
  url: string,
  text: string,
  offset: number,
  truncated: boolean,
  hashChar: string,
): WebSourcePage {
  return {
    requestedUrl: url,
    url,
    title: 'Страница',
    text,
    fetchedAt: '2026-10-18T00:00:00.000Z',
    contentHash: hashChar.repeat(64),
    offset,
    nextOffset: truncated ? offset + text.length : null,
    truncated,
    trust: 'unverified',
  };
}

function coverage(url: string, offset: number, text: string, truncated: boolean, hashChar: string) {
  return {
    url,
    offset,
    readChars: text.length,
    truncated,
    nextOffset: truncated ? offset + text.length : null,
    contentHash: hashChar.repeat(64),
  };
}

function child(
  sources: readonly MaterialResearchSource[],
  quotes: readonly { sourceId: string; quote: string; start: number }[],
): MaterialResearchResult {
  return {
    outputTruncated: false,
    summary: quotes.map((item) => item.quote).join('\n'),
    evidence: quotes.map((item) => ({
      sourceId: item.sourceId,
      name: sources.find((source) => source.sourceId === item.sourceId)?.name ?? 'x',
      quote: item.quote,
      start: item.start,
      support: 'unverified',
    })),
    openQuestions: [],
    coverage: [],
    manifest,
  };
}

function callbacks(
  run: WebResearchCallbacks['run'],
  pages: readonly WebSourcePage[] = [
    page('https://example.org/a', 'Факт на странице.', 0, false, 'a'),
  ],
): WebResearchCallbacks {
  return {
    search: async () => answer(pages.map((item) => hit(item.url))),
    fetch: async (url) => {
      const found = pages.find((item) => item.url === url);
      if (!found) throw new Error('missing page');
      return found;
    },
    run,
  };
}
