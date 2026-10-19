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
  // How far the preparation of a template has got.
  { method: 'GET', pattern: /^generation\/prepare\/[\w-]+$/ },
  { method: 'POST', pattern: /^generation\/[\w-]+\/export$/ },
  { method: 'POST', pattern: /^generation\/[\w-]+\/(cancel|resume)$/ },
  { method: 'GET', pattern: /^generation\/[\w-]+\/(deck|summary|previews)$/ },
  { method: 'GET', pattern: /^generation\/[\w-]+\/(media|artifacts)\/[\w.-]+$/ },
  { method: 'GET', pattern: /^generation\/[\w-]+\/exports\/[\w-]+\/[\w.-]+$/ },
  { method: 'GET', pattern: /^runs\/[\w-]+(\/events)?$/ },
  // Pictures of a template's sample slides in the library.
  { method: 'GET', pattern: /^files\/templates\/[\w-]+\/previews\/slide-\d+\.png$/ },
  // The original template bytes. Another instance accepts this file on the existing upload.
  { method: 'GET', pattern: /^files\/templates\/[\w-]+\/download$/ },
  // Chats: read one or the list, send a turn and stream its answer, watch a turn still running,
  // stop it, pick the deck a chat leads to, build again a variant that failed.
  { method: 'GET', pattern: /^chats(\/[\w-]+(\/stream)?)?$/ },
  { method: 'POST', pattern: /^chats\/[\w-]+\/(turns|cancel|variants\/retry)$/ },
  { method: 'PATCH', pattern: /^chats\/[\w-]+$/ },
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
