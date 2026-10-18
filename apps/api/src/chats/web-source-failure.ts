import type { WebSourceError, WebSourceFailureKind } from './web-source.js';

/**
 * What the model and activity telemetry may see after a page read fails.
 * The whitelist code is the only human-facing reason. Response bodies, credentials and
 * query strings never enter this object.
 */
export const WEB_SOURCE_CODES = [
  'web_http_401',
  'web_http_403',
  'web_http_404',
  'web_http_410',
  'web_http_429',
  'web_http_5xx',
  'web_http_error',
  'web_timeout',
  'web_unreachable',
  'web_blocked',
  'web_unsupported',
  'web_too_large',
  'web_invalid_url',
  'web_hash_mismatch',
  'web_redirect',
] as const;

export type WebSourceCode = (typeof WEB_SOURCE_CODES)[number];

export type WebSourceAction = 'try_another_source' | 'retry_later' | 'stop';

export interface WebSourceFailure {
  readonly code: 'web_source_failed';
  readonly error: WebSourceCode;
  readonly status?: number;
  readonly kind: WebSourceFailureKind;
  readonly retryable: boolean;
  readonly action: WebSourceAction;
}

const CODE_SET = new Set<string>(WEB_SOURCE_CODES);

export function isWebSourceCode(value: string): value is WebSourceCode {
  return CODE_SET.has(value);
}

/** A denial or a missing page will not change inside this turn. */
export function isNonRetryableHttp(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

export function webSourceFailure(error: WebSourceError): WebSourceFailure {
  if (error.kind === 'aborted') throw error;
  const mapped = mapFailure(error.kind, error.status);
  return {
    code: 'web_source_failed',
    error: mapped.error,
    ...(mapped.status !== undefined ? { status: mapped.status } : {}),
    kind: error.kind,
    retryable: mapped.retryable,
    action: mapped.action,
  };
}

function mapFailure(
  kind: WebSourceFailureKind,
  status: number | undefined,
): { error: WebSourceCode; status?: number; retryable: boolean; action: WebSourceAction } {
  if (kind === 'http') return mapHttp(status);
  switch (kind) {
    case 'timeout':
      return { error: 'web_timeout', retryable: true, action: 'retry_later' };
    case 'unreachable':
      return { error: 'web_unreachable', retryable: true, action: 'retry_later' };
    case 'blocked':
      return { error: 'web_blocked', retryable: false, action: 'stop' };
    case 'unsupported':
      return { error: 'web_unsupported', retryable: false, action: 'try_another_source' };
    case 'too-large':
      return { error: 'web_too_large', retryable: false, action: 'stop' };
    case 'invalid-url':
      return { error: 'web_invalid_url', retryable: false, action: 'stop' };
    case 'hash-mismatch':
      return { error: 'web_hash_mismatch', retryable: false, action: 'try_another_source' };
    case 'redirect':
      return { error: 'web_redirect', retryable: false, action: 'try_another_source' };
    case 'aborted':
      throw new Error('aborted');
    default:
      return { error: 'web_unreachable', retryable: true, action: 'retry_later' };
  }
}

function mapHttp(status: number | undefined): {
  error: WebSourceCode;
  status?: number;
  retryable: boolean;
  action: WebSourceAction;
} {
  const known =
    status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599
      ? status
      : undefined;
  if (known === 401)
    return { error: 'web_http_401', status: 401, retryable: false, action: 'try_another_source' };
  if (known === 403)
    return { error: 'web_http_403', status: 403, retryable: false, action: 'try_another_source' };
  if (known === 404)
    return { error: 'web_http_404', status: 404, retryable: false, action: 'try_another_source' };
  if (known === 410)
    return { error: 'web_http_410', status: 410, retryable: false, action: 'try_another_source' };
  if (known === 429)
    return { error: 'web_http_429', status: 429, retryable: true, action: 'retry_later' };
  if (known === 408)
    return { error: 'web_timeout', status: 408, retryable: true, action: 'retry_later' };
  if (known !== undefined && known >= 500 && known <= 599) {
    return { error: 'web_http_5xx', status: known, retryable: true, action: 'retry_later' };
  }
  if (known !== undefined && known >= 400 && known <= 499) {
    return {
      error: 'web_http_error',
      status: known,
      retryable: false,
      action: 'try_another_source',
    };
  }
  return {
    error: 'web_http_error',
    ...(known !== undefined ? { status: known } : {}),
    retryable: false,
    action: 'try_another_source',
  };
}
