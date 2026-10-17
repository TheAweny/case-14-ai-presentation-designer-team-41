import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  InvalidResearchLimitsError,
  NestedResearchDelegateError,
  runResearchDelegate,
  type ResearchDelegateInput,
  type ResearchEvidence,
} from './research-delegate.js';

const QUESTION = 'Какой срок запуска?';
const OUTPUT_CAP = 'Output cap reached before the question was fully answered.';
const CALL_CAP = 'Call cap reached before the question was fully answered.';
const DEADLINE_CAP = 'Deadline reached before the question was fully answered.';

function artifactId(question: string): string {
  return `research-${createHash('sha256').update(question, 'utf8').digest('hex').slice(0, 16)}`;
}

function validInput(overrides: Partial<ResearchDelegateInput> = {}): ResearchDelegateInput {
  return {
    question: QUESTION,
    allowedSourceKinds: ['web'],
    maxCalls: 3,
    maxOutputChars: 4000,
    deadlineMs: 5_000,
    now: () => 1_700_000_000_000,
    search: async () => [],
    fetchSource: async (url) => ({ url, kind: 'web', text: '' }),
    ...overrides,
  };
}

describe('research delegate', () => {
  it('returns a short claim with an artifact id and hides the transcript', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const page = `Cited fact. ${'x'.repeat(400)}TAIL_NOT_A_QUOTE`;
    const fetchSource = vi.fn(async (url: string) => ({ url, kind: 'web', text: page }));
    const search = vi.fn(async (query: string) => {
      expect(query).toBe(QUESTION);
      return [
        { url: 'https://a.example/report', kind: 'web', transcript: 'SECRET_TRANSCRIPT' },
        { url: 'https://a.example/skip', kind: 'social' },
      ];
    });
    try {
      const result = await runResearchDelegate(
        validInput({ question: QUESTION, search, fetchSource }),
      );
      const quote = page.slice(0, 180);
      expect(page.includes(quote)).toBe(true);
      expect(fetchSource).toHaveBeenCalledTimes(1);
      expect(fetchSource).toHaveBeenCalledWith('https://a.example/report', expect.any(AbortSignal));
      expect(result).toEqual({
        summary: quote,
        artifactId: artifactId(QUESTION),
        evidence: [{ url: 'https://a.example/report', quote, start: 0 }],
        openQuestions: [],
      });
      expect(Object.keys(result).sort()).toEqual([
        'artifactId',
        'evidence',
        'openQuestions',
        'summary',
      ]);
      const body = JSON.stringify(result);
      expect(body).not.toContain('SECRET_TRANSCRIPT');
      expect(body).not.toContain('TAIL_NOT_A_QUOTE');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('searches the trimmed question and says when the fact is missing', async () => {
    const search = vi.fn(async () => [{ url: 'https://a.example/social', kind: 'social' }]);
    const fetchSource = vi.fn();
    const result = await runResearchDelegate(
      validInput({ question: '  Какой срок?  ', search, fetchSource }),
    );
    expect(search).toHaveBeenCalledWith('Какой срок?', expect.any(AbortSignal));
    expect(fetchSource).not.toHaveBeenCalled();
    expect(result.summary).toBe('The fact is missing.');
    expect(result.evidence).toEqual([]);
    expect(result.openQuestions).toEqual([]);
    expect(result.artifactId).toBe(artifactId('Какой срок?'));
  });

  it('drops a fetched page whose kind is not allowed', async () => {
    const fetchSource = vi.fn(async (url: string) => ({
      url,
      kind: 'social',
      text: 'NOT_ALLOWED_PAGE',
    }));
    const result = await runResearchDelegate(
      validInput({
        search: async () => [{ url: 'https://a.example/a', kind: 'web' }],
        fetchSource,
      }),
    );
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(result.evidence).toEqual([]);
    expect(result.summary).toBe('The fact is missing.');
    expect(JSON.stringify(result)).not.toContain('NOT_ALLOWED_PAGE');
  });

  it('defaults to three calls and keeps evidence when the call cap stops the rest', async () => {
    const urls = ['1', '2', '3', '4'].map((id) => `https://a.example/${id}`);
    const fetchSource = vi.fn(async (url: string) => ({
      url,
      kind: 'web',
      text: `Quote ${url}`,
    }));
    const { maxCalls: _maxCalls, ...withoutCap } = validInput({
      search: async () => urls.map((url) => ({ url, kind: 'web' })),
      fetchSource,
    });
    const result = await runResearchDelegate(withoutCap);
    expect(fetchSource).toHaveBeenCalledTimes(2);
    expect(result.evidence).toEqual([
      { url: urls[0], quote: `Quote ${urls[0]}`, start: 0 },
      { url: urls[1], quote: `Quote ${urls[1]}`, start: 0 },
    ]);
    expect(result.openQuestions).toEqual([CALL_CAP]);
    expect(JSON.stringify(result)).not.toContain(urls[2]);
  });

  it('keeps the quote already fetched when the fake clock passes the deadline', async () => {
    let time = 1_000;
    const fetchSource = vi.fn(async (url: string) => {
      time += 500;
      return { url, kind: 'web', text: `Quote ${url}` };
    });
    const result = await runResearchDelegate(
      validInput({
        deadlineMs: 400,
        now: () => time,
        search: async () => [
          { url: 'https://a.example/1', kind: 'web' },
          { url: 'https://a.example/2', kind: 'web' },
        ],
        fetchSource,
      }),
    );
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(result.evidence).toEqual([
      { url: 'https://a.example/1', quote: 'Quote https://a.example/1', start: 0 },
    ]);
    expect(result.openQuestions).toEqual([DEADLINE_CAP]);
    expect(JSON.stringify(result)).not.toContain('https://a.example/2');
  });

  it('does not search when the deadline has already passed', async () => {
    const times = [1_000, 5_000];
    let index = 0;
    const search = vi.fn();
    const result = await runResearchDelegate(
      validInput({
        deadlineMs: 1_000,
        now: () => times[Math.min(index++, times.length - 1)] ?? 5_000,
        search,
        fetchSource: vi.fn(),
      }),
    );
    expect(search).not.toHaveBeenCalled();
    expect(result.evidence).toEqual([]);
    expect(result.summary).toBe('The fact is missing.');
    expect(result.openQuestions).toEqual([DEADLINE_CAP]);
  });

  it('keeps gathered evidence when another quote would exceed the output cap', async () => {
    const quote = 'Known fact.';
    const first: ResearchEvidence = { url: 'https://a.example/1', quote, start: 0 };
    const secondText = 'SECOND_FACT_SHOULD_NOT_APPEAR';
    const id = artifactId(QUESTION);
    const withQuestion = {
      summary: quote,
      artifactId: id,
      evidence: [first],
      openQuestions: [OUTPUT_CAP],
    };
    const withSecond = {
      summary: `${quote} ${secondText}`,
      artifactId: id,
      evidence: [...withQuestion.evidence, { url: 'https://a.example/2', quote: secondText }],
      openQuestions: [] as string[],
    };
    const maxOutputChars = JSON.stringify(withQuestion).length;
    expect(JSON.stringify(withSecond).length).toBeGreaterThan(maxOutputChars);
    const fetchSource = vi.fn(async (url: string) => ({
      url,
      kind: 'web',
      text: url.endsWith('/2') ? secondText : quote,
    }));
    const result = await runResearchDelegate(
      validInput({
        maxOutputChars,
        search: async () => [
          { url: 'https://a.example/1', kind: 'web' },
          { url: 'https://a.example/2', kind: 'web' },
        ],
        fetchSource,
      }),
    );
    expect(fetchSource).toHaveBeenCalledTimes(2);
    expect(result).toEqual(withQuestion);
    expect(JSON.stringify(result)).not.toContain(secondText);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(maxOutputChars);
  });

  it.each([
    ['maxCalls', 0],
    ['maxCalls', -3],
    ['maxCalls', 1.5],
    ['maxCalls', Number.NaN],
    ['maxOutputChars', 0],
    ['maxOutputChars', -1],
    ['maxOutputChars', 2.5],
    ['deadlineMs', 0],
    ['deadlineMs', -5],
    ['deadlineMs', Number.POSITIVE_INFINITY],
  ] as const)('rejects invalid %s before any call', async (field, value) => {
    const search = vi.fn();
    const fetchSource = vi.fn();
    await expect(
      runResearchDelegate(validInput({ search, fetchSource, [field]: value })),
    ).rejects.toBeInstanceOf(InvalidResearchLimitsError);
    expect(search).not.toHaveBeenCalled();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('rejects an empty question, empty kinds, and a non-finite clock before search', async () => {
    const search = vi.fn();
    const fetchSource = vi.fn();
    await expect(
      runResearchDelegate(validInput({ question: '   ', search, fetchSource })),
    ).rejects.toBeInstanceOf(InvalidResearchLimitsError);
    await expect(
      runResearchDelegate(validInput({ allowedSourceKinds: [], search, fetchSource })),
    ).rejects.toBeInstanceOf(InvalidResearchLimitsError);
    await expect(
      runResearchDelegate(validInput({ now: () => Number.NaN, search, fetchSource })),
    ).rejects.toBeInstanceOf(InvalidResearchLimitsError);
    expect(search).not.toHaveBeenCalled();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it('keeps newlines in the quote so an exact source check can find it', async () => {
    const text = 'Выручка\n\nвыросла на 25%.';
    const result = await runResearchDelegate(
      validInput({
        search: async () => [{ url: 'https://a.example/r', kind: 'web' }],
        fetchSource: async (url) => ({ url, kind: 'web', text }),
      }),
    );
    expect(result.evidence).toEqual([{ url: 'https://a.example/r', quote: text, start: 0 }]);
    expect(text.includes(result.evidence[0]?.quote ?? '')).toBe(true);
  });

  it('returns when a search ignores cancellation and outlives the deadline', async () => {
    let signal: AbortSignal | undefined;
    const search = vi.fn((_query: string, next: AbortSignal) => {
      signal = next;
      return new Promise<never>(() => undefined);
    });
    const started = Date.now();
    const result = await runResearchDelegate(
      validInput({
        deadlineMs: 40,
        now: () => Date.now(),
        search,
        fetchSource: vi.fn(),
      }),
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(search).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.openQuestions).toEqual([DEADLINE_CAP]);
  });

  it('rejects an output cap smaller than the result shell before search', async () => {
    const search = vi.fn();
    await expect(
      runResearchDelegate(validInput({ maxOutputChars: 1, search, fetchSource: vi.fn() })),
    ).rejects.toBeInstanceOf(InvalidResearchLimitsError);
    expect(search).not.toHaveBeenCalled();
  });

  it('refuses a nested delegate before the inner search', async () => {
    const innerSearch = vi.fn(async () => []);
    const outerFetch = vi.fn();
    const outerSearch = vi.fn(async () => {
      await runResearchDelegate(validInput({ search: innerSearch, fetchSource: vi.fn() }));
      return [];
    });
    await expect(
      runResearchDelegate(validInput({ search: outerSearch, fetchSource: outerFetch })),
    ).rejects.toBeInstanceOf(NestedResearchDelegateError);
    expect(outerSearch).toHaveBeenCalledTimes(1);
    expect(innerSearch).not.toHaveBeenCalled();
    expect(outerFetch).not.toHaveBeenCalled();

    const again = await runResearchDelegate(
      validInput({ search: async () => [], fetchSource: vi.fn() }),
    );
    expect(again.summary).toBe('The fact is missing.');
  });
});
