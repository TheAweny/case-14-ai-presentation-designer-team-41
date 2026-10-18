import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@lct/contracts';
import { generationBrief } from './chat-brief.js';
import { inspectChatSources } from './source-provenance.js';

function messages(): ChatMessage[] {
  const page = {
    requestedUrl: 'https://example.org/report',
    url: 'https://example.org/report',
    title: 'Report',
    text: '"\\😀'.repeat(1500),
    offset: 0,
    nextOffset: 6000,
    truncated: true,
    fetchedAt: '2026-10-18T00:00:00Z',
    contentHash: 'a'.repeat(64),
    trust: 'unverified',
  };
  return [
    {
      role: 'user',
      id: crypto.randomUUID(),
      createdAt: 1,
      mode: 'plan',
      text: 'Prepare a presentation. Correction: budget 19 million.',
      attachments: [],
    },
    {
      role: 'assistant',
      id: crypto.randomUUID(),
      createdAt: 2,
      status: 'failed',
      parts: [
        { type: 'text', text: 'UNSUPPORTED assistant-only assertion 999 million' },
        {
          type: 'tool',
          name: 'search_web',
          callId: 'search',
          input: {},
          status: 'done',
          output: { results: [{ snippet: 'UNSUPPORTED snippet 777 million' }] },
        },
        {
          type: 'tool',
          name: 'fetch_source',
          callId: 'fetch',
          input: {},
          status: 'done',
          output: page,
        },
        {
          type: 'tool',
          name: 'fetch_source',
          callId: 'failed-fetch',
          input: {},
          status: 'failed',
          output: { ...page, text: 'UNSUPPORTED failed tool 888 million' },
        },
      ],
    },
  ];
}

describe('independent provenance acceptance', () => {
  it('keeps completed source data from an interrupted answer separate from model prose and snippets', () => {
    const history = messages();
    const brief = generationBrief(history, null, 'model', []);
    expect(brief).toContain('Correction: budget 19 million');
    expect(brief).toContain('externalSources');
    expect(brief).toContain('unverified');
    expect(brief).not.toContain('UNSUPPORTED');
    expect(JSON.parse(brief).externalSources).toHaveLength(1);
    const first = inspectChatSources(history, { offset: 0, limit: 20 });
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.nextOffset === null || first.nextOffset > first.offset).toBe(true);
    expect(JSON.stringify(first).length).toBeLessThan(10000);
    expect(first.assumptions).toBe('not-assessed');
    expect(first.conflicts).toBe('not-assessed');
  });

  it('rejects a brief beyond its budget rather than silently discarding external sources', () => {
    const history = messages();
    const user = history[0];
    if (!user || user.role !== 'user') throw new Error('Missing user');
    user.text = 'А'.repeat(59000);
    expect(() => generationBrief(history, null, 'model', [])).toThrow(/обрезано/);
  });
});
