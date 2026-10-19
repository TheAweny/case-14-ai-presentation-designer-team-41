/** Forwarded host/protocol never grant CSRF trust; operators may pin the public origin. */
export function trustedOrigin(origin: string | null, url: string, publicOrigin?: string): boolean {
  if (!origin) return false;
  try {
    const candidate = new URL(origin);
    const request = new URL(url);
    if (candidate.origin === request.origin) return true;
    if (publicOrigin && candidate.origin === new URL(publicOrigin).origin) return true;
    const local = new Set(['localhost', '127.0.0.1', '[::1]']);
    return (
      local.has(candidate.hostname) &&
      local.has(request.hostname) &&
      candidate.port === request.port &&
      candidate.protocol === request.protocol
    );
  } catch {
    return false;
  }
}
