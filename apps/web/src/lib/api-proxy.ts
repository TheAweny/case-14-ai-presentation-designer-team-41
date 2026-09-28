/**
 * Which API routes the browser may reach through the proxy. Everything else — accounts, model
 * settings, the library of projects — is called only by server code, where the session was
 * already checked and the request is made for a known account.
 *
 * Module without Next or React: the list is checked by tests.
 */

const ALLOWED: readonly { readonly method: string; readonly pattern: RegExp }[] = [
  { method: 'POST', pattern: /^files\/(template|content)$/ },
  { method: 'POST', pattern: /^generation(\/prepare)?$/ },
  { method: 'POST', pattern: /^generation\/[\w-]+\/cancel$/ },
  { method: 'GET', pattern: /^generation\/[\w-]+\/(deck|previews)$/ },
  { method: 'GET', pattern: /^generation\/[\w-]+\/(media|artifacts)\/[\w.-]+$/ },
  { method: 'GET', pattern: /^runs\/[\w-]+(\/events)?$/ },
  // Chats are saved as the conversation goes on and read back after a reload.
  { method: 'GET', pattern: /^chats(\/[\w-]+)?$/ },
  { method: 'PUT', pattern: /^chats\/[\w-]+$/ },
];

/**
 * The API path for the segments after `/api/backend/`, or null when the browser may not go
 * there. Segments are encoded again: a decoded `..` or `/` cannot climb out of the route.
 */
export function proxiedApiPath(segments: readonly string[], method: string): string | null {
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  const encoded = segments.map((segment) => encodeURIComponent(segment));
  const joined = encoded.join('/');
  const allowed = ALLOWED.some(
    (rule) => rule.method === method.toUpperCase() && rule.pattern.test(joined),
  );
  return allowed ? `/${joined}` : null;
}
