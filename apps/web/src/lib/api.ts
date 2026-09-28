/**
 * The way to the API. The API answers only this web server: every request carries the service
 * token (`API_SERVICE_TOKEN`) that the installer generated for both. The browser never talks to
 * the API and never sees the token. It goes through `/api/backend/...`, a route of this server
 * that checks the session and forwards the request with the token attached
 * (`app/api/backend/[...path]/route.ts`).
 *
 * The same module serves both sides. On the server `process.env` holds the token; in the browser
 * Next inlines only `NEXT_PUBLIC_*` variables, so there the token is simply absent and the
 * request goes to the proxy instead.
 */

/** Where the browser reaches the API: through this web server, with its session cookie. */
export const API_PROXY_PATH = '/api/backend';

/** Headers the API reads; mirrored in `apps/api/src/auth/service-token.guard.ts`. */
export const SERVICE_TOKEN_HEADER = 'x-lct-service-token';
export const USER_HEADER = 'x-lct-user';

/** The API as this server reaches it: the compose service name, or localhost in development. */
export function internalApiUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

/** An address of the API for the browser: images, previews and downloads go through the proxy. */
export function publicApiUrl(path: string): string {
  return `${API_PROXY_PATH}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface ApiFetchOptions {
  /** The signed-in account the request is made for; the API records it for model settings. */
  readonly userId?: string | null;
}

/**
 * `fetch` to the API. `path` starts with `/` and names an API route, such as `/generation`.
 * On the server the answer is never cached: it is someone's library, not a public page.
 */
export function apiFetch(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  if (typeof window !== 'undefined') return fetch(publicApiUrl(path), init);
  const headers = new Headers(init.headers);
  headers.set(SERVICE_TOKEN_HEADER, process.env.API_SERVICE_TOKEN ?? '');
  if (options.userId) headers.set(USER_HEADER, options.userId);
  return fetch(`${internalApiUrl()}${path}`, { ...init, headers, cache: 'no-store' });
}
