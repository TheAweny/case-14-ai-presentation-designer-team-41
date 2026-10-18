import { describe, expect, it, vi } from 'vitest';
import { modelFailureOf, modelHttpFailure } from './model-failure.js';

describe('model failures', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limit'],
    [404, 'not-configured'],
    [503, 'unavailable'],
    [504, 'timeout'],
    [422, 'unsupported'],
  ] as const)('classifies HTTP %i without leaking the provider body', (status, kind) => {
    const error = modelHttpFailure(status, 'model-a', null, 'secret-provider-response');
    expect(modelFailureOf(error)).toEqual({ kind, modelId: 'model-a' });
    expect(error.message).not.toContain('secret-provider-response');
  });
  it('recognizes a structured context error and both Retry-After formats', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-15T00:00:00Z'));
    try {
      expect(
        modelHttpFailure(400, 'a', null, '{"error":{"code":"context_length_exceeded"}}').failure
          .kind,
      ).toBe('context');
      for (const header of ['60', 'Thu, 15 Oct 2026 00:01:00 GMT']) {
        expect(modelHttpFailure(429, 'a', header).failure.retryAt).toBe(Date.now() + 60000);
      }
      expect(modelHttpFailure(429, 'a', 'invalid').failure.retryAt).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('recognizes a known context type even when the code is unknown or absent', () => {
    expect(
      modelHttpFailure(
        400,
        'a',
        null,
        JSON.stringify({ error: { code: 'not_a_known_code', type: 'context_length_exceeded' } }),
      ).failure.kind,
    ).toBe('context');
    expect(
      modelHttpFailure(
        400,
        'a',
        null,
        JSON.stringify({ error: { type: 'context_window_exceeded' } }),
      ).failure.kind,
    ).toBe('context');
  });
  it('keeps unknown failures generic and distinguishes connection and timeout failures', () => {
    expect(modelFailureOf(new Error('something'))).toEqual({ kind: 'unknown' });
    expect(modelFailureOf(new TypeError('network'))).toEqual({ kind: 'unavailable' });
    expect(modelFailureOf(new DOMException('slow', 'TimeoutError'))).toEqual({ kind: 'timeout' });
  });

  it('classifies a structured 403 quota error without retryAt or leaking the provider body', () => {
    const body = JSON.stringify({
      error: {
        code: 'token_quota_exhausted',
        type: 'token_quota_exhausted',
        message: 'secret',
      },
    });
    const error = modelHttpFailure(403, 'model-a', '60', body);
    expect(error.failure).toEqual({ kind: 'quota-exhausted', modelId: 'model-a' });
    expect(error.failure.retryAt).toBeUndefined();
    expect(error.message).toBe('Model API HTTP 403 for model-a.');
    expect(error.message).not.toContain('secret');
    expect(JSON.stringify(error.failure)).not.toContain('secret');
  });

  it('classifies a structured 429 quota error without retryAt', () => {
    const error = modelHttpFailure(
      429,
      'model-a',
      '30',
      JSON.stringify({ error: { code: 'insufficient_quota', message: 'secret' } }),
    );
    expect(error.failure).toEqual({ kind: 'quota-exhausted', modelId: 'model-a' });
    expect(error.failure.retryAt).toBeUndefined();
    expect(error.message).not.toContain('secret');
  });

  it('recognizes a known quota type even when the code is unknown', () => {
    const error = modelHttpFailure(
      403,
      'model-a',
      null,
      JSON.stringify({ error: { code: 'not_a_known_code', type: 'token_quota_exhausted' } }),
    );
    expect(error.failure.kind).toBe('quota-exhausted');
  });

  it('keeps a 403 with an unknown or invalid code as unauthorized', () => {
    expect(
      modelHttpFailure(
        403,
        'model-a',
        null,
        JSON.stringify({ error: { code: 'not_a_known_code' } }),
      ).failure.kind,
    ).toBe('unauthorized');
    expect(
      modelHttpFailure(403, 'model-a', null, JSON.stringify({ error: { code: 12 } })).failure.kind,
    ).toBe('unauthorized');
    expect(modelHttpFailure(403, 'model-a', null, 'secret').failure.kind).toBe('unauthorized');
  });

  it('keeps an ordinary 429 as a rate limit', () => {
    const error = modelHttpFailure(429, 'model-a', '60', '{"error":{"message":"secret"}}');
    expect(error.failure.kind).toBe('rate-limit');
    expect(error.message).not.toContain('secret');
  });
});
