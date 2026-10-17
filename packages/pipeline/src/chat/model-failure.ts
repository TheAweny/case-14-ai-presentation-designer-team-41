import type { ModelFailure } from '@lct/contracts';

/** Public metadata only; provider bodies and credentials never leave this boundary. */
export class ModelRequestError extends Error {
  constructor(
    message: string,
    readonly failure: ModelFailure,
  ) {
    super(message);
  }
}

export function modelHttpFailure(
  status: number,
  modelId: string,
  retryAfter: string | null,
  body = '',
): ModelRequestError {
  let code = '';
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; type?: unknown } };
    const value = parsed.error?.code ?? parsed.error?.type;
    if (typeof value === 'string') code = value;
  } catch {
    /* Non-JSON provider responses still have an HTTP status. */
  }
  const kind: ModelFailure['kind'] = [
    'context_length_exceeded',
    'context_window_exceeded',
  ].includes(code)
    ? 'context'
    : status === 401 || status === 403
      ? 'unauthorized'
      : status === 429
        ? 'rate-limit'
        : status === 404
          ? 'not-configured'
          : status === 408 || status === 504
            ? 'timeout'
            : status === 400 || status === 422 || status === 501
              ? 'unsupported'
              : status >= 500
                ? 'unavailable'
                : 'unknown';
  const delay = retryAfter === null ? NaN : Number(retryAfter);
  const retryAt =
    retryAfter === null
      ? NaN
      : Number.isFinite(delay)
        ? Date.now() + delay * 1000
        : Date.parse(retryAfter);
  return new ModelRequestError(`Model API HTTP ${status} for ${modelId}.`, {
    kind,
    modelId,
    ...(Number.isFinite(retryAt) ? { retryAt: Math.max(Date.now(), retryAt) } : {}),
  });
}

export function modelFailureOf(error: unknown): ModelFailure {
  if (error instanceof ModelRequestError) return error.failure;
  if (error instanceof Error && error.name === 'TimeoutError') return { kind: 'timeout' };
  if (error instanceof TypeError) return { kind: 'unavailable' };
  return { kind: 'unknown' };
}
