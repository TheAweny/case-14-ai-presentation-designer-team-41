/** Only transient transport failures can be retried automatically. */
export class ChatHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: string | null = null,
  ) {
    super(message);
  }
}

export function canRetryChat(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ChatHttpError && [408, 429, 500, 502, 503, 504].includes(error.status))
  );
}

/** Backoff is bounded; a provider's longer Retry-After ends automatic retries. */
export function chatRetryDelay(attempt: number, error?: unknown): number {
  if (error instanceof ChatHttpError && error.retryAfter) {
    const seconds = Number(error.retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(error.retryAfter) - Date.now();
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  return Math.min(4000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200);
}
