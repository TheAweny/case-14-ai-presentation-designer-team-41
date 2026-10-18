import { describe, expect, it, vi } from 'vitest';
import { createAssetSearch } from './asset-search.js';

describe('independent asset search acceptance', () => {
  it('keeps public image provenance without downloading images or guessing licensing', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        results: [
          {
            url: 'https://example.org/source',
            title: 'Photo',
            img_src: 'https://cdn.example.org/photo.jpg',
          },
          {
            url: 'https://example.org/licensed',
            title: 'Public work',
            img_src: 'https://cdn.example.org/work.jpg',
            license: 'CC BY 4.0',
          },
          {
            url: 'https://example.org/long',
            title: 'Rights',
            img_src: 'https://cdn.example.org/long.jpg',
            license: 'condition '.repeat(100),
          },
          {
            url: 'https://example.org/private',
            title: 'Internal',
            img_src: 'https://cdn.internal/photo.jpg',
          },
          {
            url: 'https://example.org:8443/port',
            title: 'Port',
            img_src: 'https://cdn.example.org/photo.jpg',
          },
        ],
        unresponsive_engines: [],
      }),
    );
    const search = createAssetSearch({
      baseUrl: 'http://search:8080',
      fetch,
      resolve: async (host) => (host === 'cdn.internal' ? ['8.8.8.8', '127.0.0.1'] : ['8.8.8.8']),
    });
    const result = await search.search('photo', new AbortController().signal);
    expect(result.assets.map((asset) => asset.url)).toEqual([
      'https://example.org/source',
      'https://example.org/licensed',
      'https://example.org/long',
    ]);
    expect(result.assets.map((asset) => asset.license)).toEqual([
      'unknown',
      'CC BY 4.0',
      'unknown',
    ]);
    expect(result.trust).toBe('search-results-not-evidence');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result).length).toBeLessThan(10000);
  });
});
