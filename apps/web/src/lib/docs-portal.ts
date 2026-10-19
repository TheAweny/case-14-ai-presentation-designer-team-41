/**
 * Pages of the external docs portal. A redirect is emitted only when
 * `DOCS_PUBLIC_URL` is set and the path is in this list, so `/api/docs` stays
 * on the application and unknown URLs are not sent to a 404 on another host.
 */
export const DOCS_PORTAL_PATHS = [
  '/docs/getting-started',
  '/docs/guide',
  '/docs/guide/projects',
  '/docs/guide/assistant',
  '/docs/guide/variants',
  '/docs/guide/editing',
  '/docs/operations',
  '/docs/cli',
  '/docs/internals',
  '/docs/internals/pipeline',
  '/docs/internals/layers',
  '/docs/internals/decisions',
  '/docs/developers',
  '/docs/developers/contracts',
  '/docs/api',
  '/docs/api/access',
  '/docs/api/reference',
  '/docs/api/reference/generation',
  '/docs/api/reference/editor',
  '/docs/api/reference/files',
  '/docs/api/reference/chats',
  '/docs/api/reference/runs',
  '/docs/api/reference/library',
  '/docs/api/reference/models',
  '/docs/api/reference/users',
  '/docs/api/reference/auth',
  '/docs/api/reference/health',
  '/docs/api/reference/schemas',
  '/docs/troubleshooting',
  '/docs/authors',
  '/docs/authors/markdown',
  '/docs/authors/components',
] as const;

const PAGES = new Set<string>(DOCS_PORTAL_PATHS);

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

/** Absolute URL on the docs host, or null when the redirect must not happen. */
export function docsPortalDestination(pathname: string, origin: string | undefined): string | null {
  const base = origin?.trim().replace(/\/+$/, '') ?? '';
  if (!base) return null;
  const path = normalize(pathname);
  if (path === '/api/docs' || path.startsWith('/api/docs/')) return null;
  if (path === '/docs') return `${base}/`;
  if (!PAGES.has(path)) return null;
  return `${base}${path}/`;
}
