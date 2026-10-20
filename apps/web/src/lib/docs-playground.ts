/**
 * The documentation site is a static host on its own origin. It cannot hold the service token
 * and it cannot send the httpOnly session cookie. The console on that site signs in here and
 * then calls the API through this server, which attaches the token.
 *
 * No Next or React: the allow-list and the path check are tested on their own.
 */

const LOCAL_DOCS_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'] as const;

/** Origins whose browser may read console answers. */
export function docsConsoleOrigins(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const found = new Set<string>(LOCAL_DOCS_ORIGINS);
  for (const value of [env.DOCS_PUBLIC_URL, env.NEXT_PUBLIC_DOCS_URL]) {
    const origin = originOf(value);
    if (origin) found.add(origin);
  }
  return [...found];
}

/**
 * A browser always sends `Origin`. A missing origin is a non-browser client that already has
 * the bearer. A present origin must be this web server or the docs site.
 */
export function playgroundOriginAllowed(
  origin: string | null,
  requestUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!origin) return true;
  const candidate = originOf(origin);
  if (!candidate) return false;
  try {
    if (candidate === new URL(requestUrl).origin) return true;
  } catch {
    return false;
  }
  return docsConsoleOrigins(env).includes(candidate);
}

/** `Bearer <token>` or null. Anything else is refused rather than partly accepted. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Payload of a signed docs-console token: `<user id>:session:<server session>`.
 * The first marker splits them; a session token from the API does not contain it.
 */
export function sessionIdentity(
  payload: string,
): { readonly userId: string; readonly sessionToken: string } | null {
  const marker = ':session:';
  const index = payload.indexOf(marker);
  if (index <= 0) return null;
  const userId = payload.slice(0, index);
  const sessionToken = payload.slice(index + marker.length);
  if (!userId || !sessionToken) return null;
  return { userId, sessionToken };
}

/**
 * API path for the segments after `/api/docs-playground/`. Null when a segment could climb
 * out of the route. Segments are encoded again.
 */
export function playgroundApiPath(segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function originOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}
