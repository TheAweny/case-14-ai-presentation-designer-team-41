import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBrowserDocument } from '@/lib/api-docs';
import { GET } from './route';

vi.mock('@/lib/api-docs', () => ({ fetchBrowserDocument: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/docs-json', () => {
  it.each([undefined, 'false', 'invalid'])(
    'returns 404 without contacting the API when disabled (%s)',
    async (value) => {
      vi.stubEnv('API_DOCS_ENABLED', value);
      const response = await GET();
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(fetchBrowserDocument).not.toHaveBeenCalled();
    },
  );

  it('serves the browser document when enabled at request time', async () => {
    const document = { openapi: '3.0.0', servers: [{ url: '/api/backend' }], paths: {} };
    vi.mocked(fetchBrowserDocument).mockResolvedValue(document);
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    expect((await GET()).status).toBe(404);
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(document);
    expect(response.headers.get('content-disposition')).toBe('inline; filename="openapi.json"');
    expect(fetchBrowserDocument).toHaveBeenCalledTimes(1);
    vi.stubEnv('API_DOCS_ENABLED', 'false');
    expect((await GET()).status).toBe(404);
    expect(fetchBrowserDocument).toHaveBeenCalledTimes(1);
  });

  it('preserves 503 for an unavailable API when enabled', async () => {
    vi.stubEnv('API_DOCS_ENABLED', 'true');
    vi.mocked(fetchBrowserDocument).mockResolvedValue(null);
    expect((await GET()).status).toBe(503);
  });
});
