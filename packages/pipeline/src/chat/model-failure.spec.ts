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
  it('keeps unknown failures generic and distinguishes connection and timeout failures', () => {
    expect(modelFailureOf(new Error('something'))).toEqual({ kind: 'unknown' });
    expect(modelFailureOf(new TypeError('network'))).toEqual({ kind: 'unavailable' });
    expect(modelFailureOf(new DOMException('slow', 'TimeoutError'))).toEqual({ kind: 'timeout' });
  });
});
