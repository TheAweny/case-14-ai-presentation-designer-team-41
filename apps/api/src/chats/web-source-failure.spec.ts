import { describe, expect, it } from 'vitest';
import { WebSourceError, type WebSourceFailureKind } from './web-source.js';
import {
  WEB_SOURCE_CODES,
  isNonRetryableHttp,
  isWebSourceCode,
  webSourceFailure,
  type WebSourceAction,
  type WebSourceCode,
  type WebSourceFailure,
} from './web-source-failure.js';

const SECRET = 'Authorization: Bearer sk-live-SECRET token=super-secret proxy.paid.example';

function httpError(status: number | undefined, message = `upstream ${SECRET}`): WebSourceError {
  return new WebSourceError('http', message, status);
}

function expectSafe(failure: WebSourceFailure, error: WebSourceCode): void {
  const encoded = JSON.stringify(failure);
  expect(failure.code).toBe('web_source_failed');
  expect(failure.error).toBe(error);
  expect(WEB_SOURCE_CODES).toContain(failure.error);
  expect(isWebSourceCode(failure.error)).toBe(true);
  expect(encoded).not.toContain('SECRET');
  expect(encoded).not.toContain('Bearer');
  expect(encoded).not.toContain('Authorization');
  expect(encoded).not.toContain('proxy.paid');
  expect(encoded).not.toContain('super-secret');
  expect(encoded).not.toContain('upstream');
  expect(failure).not.toHaveProperty('message');
  const keys =
    failure.status === undefined
      ? ['action', 'code', 'error', 'kind', 'retryable']
      : ['action', 'code', 'error', 'kind', 'retryable', 'status'];
  expect(Object.keys(failure).sort()).toEqual(keys);
}

describe('webSourceFailure', () => {
  it.each([
    [401, 'web_http_401', false, 'try_another_source'],
    [403, 'web_http_403', false, 'try_another_source'],
    [404, 'web_http_404', false, 'try_another_source'],
    [410, 'web_http_410', false, 'try_another_source'],
    [429, 'web_http_429', true, 'retry_later'],
    [503, 'web_http_5xx', true, 'retry_later'],
    [408, 'web_timeout', true, 'retry_later'],
    [451, 'web_http_error', false, 'try_another_source'],
  ] as const)('maps HTTP %s to %s without the raw body', (status, error, retryable, action) => {
    const failure = webSourceFailure(httpError(status));
    expectSafe(failure, error);
    expect(failure).toEqual({
      code: 'web_source_failed',
      error,
      status,
      kind: 'http',
      retryable,
      action,
    });
    expect(isNonRetryableHttp(status)).toBe(
      status === 401 || status === 403 || status === 404 || status === 410,
    );
  });

  it('keeps 5xx inside one whitelist code and leaves other 4xx generic', () => {
    for (const status of [500, 503, 599]) {
      const failure = webSourceFailure(httpError(status, SECRET));
      expectSafe(failure, 'web_http_5xx');
      expect(failure).toMatchObject({
        status,
        kind: 'http',
        retryable: true,
        action: 'retry_later',
      });
    }
    const unavailable = webSourceFailure(httpError(451, SECRET));
    expectSafe(unavailable, 'web_http_error');
    expect(unavailable.retryable).toBe(false);
    expect(isNonRetryableHttp(451)).toBe(false);
    expect(isNonRetryableHttp(400)).toBe(false);
  });

  it('does not promote a fractional 403 or a missing status into a denial code', () => {
    const fractional = webSourceFailure(httpError(403.5, SECRET));
    expectSafe(fractional, 'web_http_error');
    expect(fractional.status).toBeUndefined();
    expect(fractional.retryable).toBe(false);
    expect(isNonRetryableHttp(403.5)).toBe(false);
    for (const status of [99, 600]) {
      const outside = webSourceFailure(httpError(status, SECRET));
      expectSafe(outside, 'web_http_error');
      expect(outside.status).toBeUndefined();
    }

    const missing = webSourceFailure(new WebSourceError('http', SECRET));
    expectSafe(missing, 'web_http_error');
    expect(missing).toEqual({
      code: 'web_source_failed',
      error: 'web_http_error',
      kind: 'http',
      retryable: false,
      action: 'try_another_source',
    });
  });

  it('maps non-http kinds without copying a misleading status or the secret', () => {
    const cases: ReadonlyArray<
      readonly [WebSourceFailureKind, WebSourceCode, boolean, WebSourceAction]
    > = [
      ['timeout', 'web_timeout', true, 'retry_later'],
      ['unreachable', 'web_unreachable', true, 'retry_later'],
      ['blocked', 'web_blocked', false, 'stop'],
      ['unsupported', 'web_unsupported', false, 'try_another_source'],
      ['too-large', 'web_too_large', false, 'stop'],
      ['invalid-url', 'web_invalid_url', false, 'stop'],
      ['hash-mismatch', 'web_hash_mismatch', false, 'try_another_source'],
      ['redirect', 'web_redirect', false, 'try_another_source'],
    ];
    for (const [kind, error, retryable, action] of cases) {
      const failure = webSourceFailure(new WebSourceError(kind, `dns ${SECRET}`, 403));
      expectSafe(failure, error);
      expect(failure).toEqual({
        code: 'web_source_failed',
        error,
        kind,
        retryable,
        action,
      });
      expect(failure.status).toBeUndefined();
    }
  });

  it('throws aborted instead of mapping it as a timeout', () => {
    const aborted = new WebSourceError('aborted', `timeout ${SECRET}`, 408);
    expect(() => webSourceFailure(aborted)).toThrow(aborted);
    try {
      webSourceFailure(aborted);
      expect.unreachable();
    } catch (caught) {
      expect(caught).toBe(aborted);
    }

    const disguised = webSourceFailure(new WebSourceError('timeout', `aborted ${SECRET}`, 408));
    expectSafe(disguised, 'web_timeout');
    expect(disguised).toEqual({
      code: 'web_source_failed',
      error: 'web_timeout',
      kind: 'timeout',
      retryable: true,
      action: 'retry_later',
    });
  });

  it('accepts only the whitelist and rejects the raw error text', () => {
    expect(new Set(WEB_SOURCE_CODES).size).toBe(WEB_SOURCE_CODES.length);
    for (const code of WEB_SOURCE_CODES) expect(isWebSourceCode(code)).toBe(true);
    expect(isWebSourceCode(SECRET)).toBe(false);
    expect(isWebSourceCode('web_http_403 ')).toBe(false);
    expect(isWebSourceCode('web_http_418')).toBe(false);
    expect(isWebSourceCode('timeout')).toBe(false);
    expect(isWebSourceCode('aborted')).toBe(false);
    expect(isWebSourceCode('')).toBe(false);
    expect([401, 403, 404, 410].every((status) => isNonRetryableHttp(status))).toBe(true);
    expect(
      [408, 429, 451, 500, 503, 200, undefined].some((status) => isNonRetryableHttp(status)),
    ).toBe(false);
  });
});
