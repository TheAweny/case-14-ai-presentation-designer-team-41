import { describe, expect, it, vi } from 'vitest';
import { createAssetSearch } from './asset-search.js';
import { WebSearchError } from './web-search.js';

const recorded = {
  results: [
    {
      url: 'https://example.org/page',
      title: 'Страница',
      content: 'Подпись к картинке.',
      img_src: 'https://example.org/a.jpg',
      publishedDate: '2026-10-18',
    },
    {
      url: 'https://example.org/missing',
      title: 'Без файла',
      content: 'Нет img_src.',
    },
    {
      url: 'https://example.org/hidden',
      title: 'Закрытая',
      content: 'Картинка во внутренней сети.',
      img_src: 'https://cdn.internal/secret.jpg',
    },
    {
      url: 'https://user:pass@example.org/creds',
      title: 'Секрет в адресе',
      content: 'Учётка в URL страницы.',
      img_src: 'https://example.org/b.jpg',
    },
    {
      url: 'https://example.org/licensed',
      title: 'Лицензия',
      content: 'Поле license как в источнике.',
      img_src: 'https://example.org/c.jpg',
      license: 'CC-BY-4.0',
    },
    {
      url: 'https://example.org/plain',
      title: 'Без лицензии',
      content: 'Поле license отсутствует.',
      img_src: 'https://images.example/d.jpg',
      license: '  ',
    },
    {
      url: 'https://example.org:8443/ported',
      title: 'Порт',
      content: 'Страница не на 80 или 443.',
      img_src: 'https://example.org/e.jpg',
      license: 'CC-BY-4.0',
    },
    {
      url: 'https://example.org/odd-image',
      title: 'Порт картинки',
      content: 'Картинка не на 80 или 443.',
      img_src: 'http://example.org:8080/f.jpg',
    },
    {
      url: 'https://example.org/long-license',
      title: 'Длинная лицензия',
      content: 'Текст длиннее 200 символов не режется.',
      img_src: 'https://example.org/g.jpg',
      license: 'L'.repeat(201),
    },
  ],
  unresponsive_engines: [],
};

function client() {
  const calls: RequestInit[] = [];
  const urls: string[] = [];
  const search = createAssetSearch({
    baseUrl: 'http://search:8080',
    now: () => new Date('2026-10-18T12:00:00.000Z'),
    resolve: async (host) => (host === 'cdn.internal' ? ['10.1.1.1'] : ['8.8.8.8']),
    fetch: async (input, init) => {
      urls.push(String(input));
      calls.push(init ?? {});
      return Response.json(recorded);
    },
  });
  return { search, calls, urls };
}

describe('asset search', () => {
  it('maps a recorded images response and skips a missing picture', async () => {
    const { search, urls, calls } = client();
    const answer = await search.search('схема', new AbortController().signal);
    const params = new URL(urls[0] ?? '').searchParams;
    expect(params.get('q')).toBe('схема');
    expect(params.get('format')).toBe('json');
    expect(params.get('categories')).toBe('images');
    expect(urls).toHaveLength(1);
    expect(calls[0]?.headers).toEqual({ accept: 'application/json' });
    expect(JSON.stringify(calls[0]?.headers)).not.toMatch(/cookie/i);
    expect(answer.trust).toBe('search-results-not-evidence');
    expect(answer.searchedAt).toBe('2026-10-18T12:00:00.000Z');
    expect(answer.complete).toBe(true);
    expect(answer.assets.map((item) => item.url)).toEqual([
      'https://example.org/page',
      'https://example.org/licensed',
      'https://example.org/plain',
      'https://example.org/long-license',
    ]);
    expect(answer.assets[0]).toEqual({
      url: 'https://example.org/page',
      imageUrl: 'https://example.org/a.jpg',
      title: 'Страница',
      license: 'unknown',
    });
    expect(answer.assets[1]?.license).toBe('CC-BY-4.0');
    expect(answer.assets[1]?.imageUrl).toBe('https://example.org/c.jpg');
    expect(answer.assets[1]?.url).toBe('https://example.org/licensed');
    expect(answer.assets[2]?.license).toBe('unknown');
    expect(answer.assets[3]?.license).toBe('unknown');
    expect(answer.assets[3]?.imageUrl).toBe('https://example.org/g.jpg');
    expect(JSON.stringify(answer).length).toBeLessThan(10_000);
  });

  it('rejects a private image address without fetching that address', async () => {
    const resolve = vi.fn(async (host: string) =>
      host === 'cdn.internal' ? ['10.1.1.1'] : ['8.8.8.8'],
    );
    const fetched: string[] = [];
    const search = createAssetSearch({
      baseUrl: 'http://search:8080',
      resolve,
      fetch: async (input) => {
        fetched.push(String(input));
        return Response.json({
          results: [
            {
              url: 'https://example.org/hidden',
              title: 'Закрытая',
              content: 'Картинка во внутренней сети.',
              img_src: 'https://cdn.internal/secret.jpg',
            },
          ],
        });
      },
    });
    const answer = await search.search('схема', new AbortController().signal, 5);
    expect(answer.assets).toEqual([]);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).not.toContain('cdn.internal');
    expect(resolve).toHaveBeenCalledWith('cdn.internal');
  });

  it('refuses a limit above five', async () => {
    const search = createAssetSearch({
      baseUrl: 'http://search:8080',
      fetch: async () => {
        throw new Error('offline');
      },
    });
    await expect(search.search('схема', new AbortController().signal, 6)).rejects.toBeInstanceOf(
      WebSearchError,
    );
  });
});
