import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@lct/contracts';
import { generationBrief } from './chat-brief.js';
import { chatSourceFacts, inspectChatSources } from './source-provenance.js';

const hash = 'a'.repeat(64);
const url = 'https://example.org/report';

function user(
  text: string,
  attachments: ChatMessage extends never
    ? never
    : Extract<ChatMessage, { role: 'user' }>['attachments'] = [],
): ChatMessage {
  return {
    role: 'user',
    id: '11111111-1111-4111-8111-111111111111',
    text,
    attachments,
    mode: 'plan',
    createdAt: 1,
  };
}

function assistant(
  parts: Extract<ChatMessage, { role: 'assistant' }>['parts'],
  status: 'done' | 'failed' = 'done',
): ChatMessage {
  return {
    role: 'assistant',
    id: '22222222-2222-4222-8222-222222222222',
    parts,
    status,
    createdAt: 2,
  };
}

function fetched(text: string) {
  return {
    requestedUrl: url,
    url,
    title: 'Отчёт',
    text,
    fetchedAt: '2026-10-18T00:00:00.000Z',
    contentHash: hash,
    offset: 12,
    nextOffset: null,
    truncated: false,
    trust: 'unverified' as const,
  };
}

function researched(quote: string, summary: string) {
  return {
    outputTruncated: false,
    searchedQuery: 'вопрос',
    complete: true,
    unresponsiveEngines: [],
    summary,
    evidence: [
      {
        url,
        title: 'Отчёт',
        quote,
        start: 4,
        fetchedAt: '2026-10-18T00:00:00.000Z',
        contentHash: hash,
        support: 'unverified' as const,
      },
    ],
    openQuestions: [],
    failures: [],
    coverage: [
      {
        url,
        offset: 0,
        readChars: quote.length,
        truncated: false,
        nextOffset: null,
        contentHash: hash,
      },
    ],
    manifest: null,
  };
}

describe('inspectChatSources', () => {
  it('keeps fetched and researched text and drops assistant prose and search snippets', () => {
    const pageText = 'Выручка выросла на 12 процентов. ' + '"кавычки"'.repeat(40);
    const quote = 'выросла на 12 процентов';
    const messages = [
      user('Исправление: бюджет 9 млн', [
        {
          kind: 'slides',
          deckId: 'deck',
          slideNumber: 2,
          name: 'Слайд',
          elements: [{ kind: 'text', role: 'body', text: 'секрет слайда '.repeat(80) }],
        },
      ]),
      assistant(
        [
          { type: 'text', text: 'Модель: бюджет 3 млн' },
          {
            type: 'tool',
            callId: 's',
            name: 'search_web',
            input: {},
            status: 'done',
            output: { results: [{ snippet: 'сниппет не факт' }] },
          },
          {
            type: 'tool',
            callId: 'f',
            name: 'fetch_source',
            input: {},
            status: 'done',
            output: fetched(pageText),
          },
          {
            type: 'tool',
            callId: 'r',
            name: 'research_topic',
            input: {},
            status: 'done',
            output: researched(quote, 'выдуманное резюме модели'),
          },
          {
            type: 'tool',
            callId: 'x',
            name: 'fetch_source',
            input: {},
            status: 'failed',
            output: fetched('не прочитано'),
          },
        ],
        'failed',
      ),
    ];
    const facts = chatSourceFacts(messages);
    expect(
      facts
        .filter((item) => item.kind === 'fetch_source')
        .map((item) => (item.kind === 'fetch_source' ? item.text : '')),
    ).toEqual([pageText]);
    const page = inspectChatSources(messages, { offset: 0, limit: 20 });
    expect(JSON.stringify(page).length).toBeLessThan(10000);
    expect(JSON.stringify(page)).not.toContain('секрет слайда');
    expect(JSON.stringify(page)).not.toContain('сниппет не факт');
    expect(JSON.stringify(page)).not.toContain('выдуманное резюме');
    expect(JSON.stringify(page)).not.toContain('Модель: бюджет 3 млн');
    expect(JSON.stringify(page)).not.toContain('не прочитано');
    const fetchedCard = page.items.find((item) => item.kind === 'fetch_source');
    expect(fetchedCard && fetchedCard.kind === 'fetch_source' ? fetchedCard.excerpt : '').toBe(
      [...pageText].slice(0, 500).join(''),
    );
    expect(fetchedCard && fetchedCard.kind === 'fetch_source' ? fetchedCard.textChars : 0).toBe(
      [...pageText].length,
    );
    const slide = page.items.find((item) => item.kind === 'user-attachment');
    expect(slide).toMatchObject({ attachmentKind: 'slides', slideNumber: 2, objectCount: 1 });
    const brief = generationBrief(messages, null, 'model', []);
    const parsed = JSON.parse(brief) as {
      externalSources: { quote: string }[];
      assumptions: string;
      conflicts: string;
    };
    expect(parsed.externalSources.map((item) => item.quote)).toEqual([pageText, quote]);
    expect(parsed.assumptions).toBe('not-assessed');
    expect(parsed.conflicts).toBe('not-assessed');
    expect(brief).toContain('Исправление: бюджет 9 млн');
    expect(brief).not.toContain('Модель: бюджет 3 млн');
    expect(brief).not.toContain('сниппет не факт');
    expect(brief).not.toContain('выдуманное резюме модели');
  });

  it('advances past a page even when the stored text is full of escapes', () => {
    const noisy = '"' + '\\'.repeat(2000);
    const messages = [
      assistant([
        {
          type: 'tool',
          callId: 'a',
          name: 'fetch_source',
          input: {},
          status: 'done',
          output: fetched(noisy),
        },
        {
          type: 'tool',
          callId: 'b',
          name: 'fetch_source',
          input: {},
          status: 'done',
          output: fetched('вторая страница'),
        },
      ]),
    ];
    const first = inspectChatSources(messages, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextOffset).toBe(1);
    expect(JSON.stringify(first).length).toBeLessThan(10000);
    const second = inspectChatSources(messages, { offset: first.nextOffset ?? 0, limit: 1 });
    expect(second.items[0]).toMatchObject({ kind: 'fetch_source', excerpt: 'вторая страница' });
    expect(second.nextOffset).toBeNull();
  });

  it('rejects a limit that cannot make progress', () => {
    expect(() => inspectChatSources([], { limit: 0 })).toThrow('invalid-limit');
    expect(() => inspectChatSources([], { limit: 21 })).toThrow('invalid-limit');
  });

  it('fails the brief explicitly when web text and requirements pass 60000 characters', () => {
    const messages = [
      user('А'.repeat(30000)),
      assistant([
        {
          type: 'tool',
          callId: 'f',
          name: 'fetch_source',
          input: {},
          status: 'done',
          output: fetched('Б'.repeat(8000)),
        },
      ]),
      user('В'.repeat(30000)),
    ];
    expect(() => generationBrief(messages, null, 'model', [])).toThrow(/не было обрезано/);
  });
});
