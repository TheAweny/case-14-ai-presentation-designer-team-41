import { describe, expect, it } from 'vitest';
import { resultOf, withFailed, withVariant, type ResultPart } from './chat-results.js';

const BUILD = '00000000-0000-4000-8000-0000000000b1';

const result: ResultPart = {
  type: 'result',
  buildId: BUILD,
  variants: [
    { variant: 'balanced', deckId: 'run-balanced' },
    { variant: 'airy', deckId: 'run-airy' },
  ],
  reviews: {
    'run-balanced': { errors: 2, warnings: 1 },
    'run-airy': { errors: 1, warnings: 0 },
  },
  recommended: 'airy',
  elapsedMs: 40000,
  failed: [{ variant: 'dense', runId: 'run-dense', status: 'failed', reason: 'HTTP 429' }],
};

describe('a variant built again', () => {
  it('shows as being rebuilt with its new run, in place of the failed one', () => {
    const retrying = withFailed(result, {
      variant: 'dense',
      runId: 'run-dense-2',
      status: 'retrying',
      reason: null,
    });
    expect(retrying.failed).toEqual([
      { variant: 'dense', runId: 'run-dense-2', status: 'retrying', reason: null },
    ]);
    expect(retrying.variants).toEqual(result.variants);
  });

  it('joins the result in its place, with its audit, and the advice is made again', () => {
    const done = withVariant(result, 'dense', 'run-dense-2', { errors: 0, warnings: 0 });
    expect(done.variants.map((item) => item.variant)).toEqual(['dense', 'balanced', 'airy']);
    expect(done.reviews?.['run-dense-2']).toEqual({ errors: 0, warnings: 0 });
    expect(done.recommended).toBe('dense');
    expect(done.failed).toBeUndefined();
  });

  it('leaves the build without a comparable audit when its own cannot be read', () => {
    const done = withVariant(result, 'dense', 'run-dense-2', null);
    expect(done.reviews).toBeNull();
    // Without audits the advice falls back to the default preference.
    expect(done.recommended).toBe('balanced');
  });

  it('keeps the other failed variant when one of two is rebuilt', () => {
    const two = withFailed(result, {
      variant: 'airy',
      runId: 'run-airy-x',
      status: 'failed',
      reason: null,
    });
    const done = withVariant(two, 'dense', 'run-dense-2', { errors: 0, warnings: 0 });
    expect(done.failed?.map((item) => item.variant)).toEqual(['airy']);
  });

  it('is found by its build among the messages of the chat', () => {
    const messages = [
      { role: 'user', id: 'u', text: 'x', attachments: [], createdAt: '2026-10-16T00:00:00Z' },
      { role: 'assistant', id: 'a', parts: [result], createdAt: '2026-10-16T00:00:00Z' },
    ] as unknown as Parameters<typeof resultOf>[0];
    expect(resultOf(messages, BUILD)).toBe(result);
    expect(resultOf(messages, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
