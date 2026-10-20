import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';
import { apiDocsEnabled } from './lib/api-docs-access';
import { SESSION_COOKIE } from './lib/auth';
import { signSessionToken } from './lib/session-token';

afterEach(() => vi.unstubAllEnvs());

const DOCS_PATHS = [
  '/api/docs',
  '/api/docs/',
  '/api/docs/guide/pipeline',
  '/api/docs/reference/generation',
  '/api/docs/reference/schemas',
  '/api/docs/arbitrary/nested/page',
  '/api/docs/guide/example.svg',
  '/api/docs-json',
  '/api/docs-json/',
  '/API/DOCS/reference/schemas',
];

describe('API documentation server gate', () => {
  it('preserves external portal redirects when runtime API docs are disabled', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    vi.stubEnv('DOCS_PUBLIC_URL', 'https://docs.example.com');
    const response = await proxy(new NextRequest('http://localhost/docs/cli'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://docs.example.com/docs/cli/');
  });

  it.each([undefined, '', 'false', '0', '1', 'TRUE', 'invalid', 'true'])(
    'requires explicit opt-in (value: %s)',
    (value) => {
      vi.stubEnv('API_DOCS_ENABLED', value);
      expect(apiDocsEnabled()).toBe(value === 'true');
    },
  );

  it.each(DOCS_PATHS)('matches and protects %s before rendering', async (path) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);
    const request = new NextRequest(`http://localhost${path}?download=1`);
    for (const flag of [undefined, 'false', 'true', 'false']) {
      vi.stubEnv('API_DOCS_ENABLED', flag);
      const response = await proxy(request);
      expect(response.status).toBe(flag === 'true' ? 200 : 404);
      expect(response.headers.get('location')).toBeNull();
      if (flag === 'true') {
        expect(response.headers.get('x-middleware-next')).toBe('1');
      } else {
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-middleware-next')).toBeNull();
      }
    }
  });

  it('returns 404 even with a valid signed session', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    vi.stubEnv('AUTH_SECRET', 'docs-test-secret');
    const token = await signSessionToken(
      `docs-user:session:${'a'.repeat(43)}`,
      Date.now() + 60000,
      'docs-test-secret',
    );
    const request = new NextRequest('http://localhost/api/docs', {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect((await proxy(request)).status).toBe(404);
  });

  it.each(['/library', '/api/docs-other', '/api/docs-json-other'])(
    'preserves login protection for %s when docs are enabled',
    async (path) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);
      vi.stubEnv('API_DOCS_ENABLED', 'true');
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
    },
  );
});
