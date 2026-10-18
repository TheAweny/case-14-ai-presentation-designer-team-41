import {
  createWebSearch,
  SEARCH_TRUST,
  WebSearchError,
  type SearchTrust,
  type WebSearchOptions,
} from './web-search.js';

/**
 * Image leads from the same SearXNG client as web search.
 * `url` is the source page. The image is not downloaded.
 */

const MAX_ASSET_LIMIT = 5;
const MIN_ASSET_LIMIT = 1;
const MAX_ASSET_JSON = 10_000;

export interface AssetSearchHit {
  readonly url: string;
  readonly imageUrl: string;
  readonly title: string;
  readonly license: string;
}

export interface AssetSearchAnswer {
  readonly query: string;
  readonly assets: readonly AssetSearchHit[];
  readonly searchedAt: string;
  readonly complete: boolean;
  readonly trust: SearchTrust;
}

export interface AssetSearch {
  search(query: string, signal: AbortSignal, limit?: number): Promise<AssetSearchAnswer>;
}

export function createAssetSearch(options: WebSearchOptions): AssetSearch {
  const web = createWebSearch({ ...options, category: 'images' });
  return {
    async search(query, signal, limit = MAX_ASSET_LIMIT) {
      if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < MIN_ASSET_LIMIT ||
        limit > MAX_ASSET_LIMIT
      ) {
        throw new WebSearchError('invalid-limit');
      }
      const answer = await web.search(query, signal, limit);
      const assets: AssetSearchHit[] = [];
      for (const result of answer.results) {
        if (typeof result.imageUrl !== 'string' || result.imageUrl === '') continue;
        assets.push({
          url: result.url,
          imageUrl: result.imageUrl,
          title: result.title,
          license: result.license && result.license !== '' ? result.license : 'unknown',
        });
      }
      return fitAssets({
        query: answer.query,
        assets,
        searchedAt: answer.searchedAt,
        complete: answer.complete,
        trust: SEARCH_TRUST,
      });
    },
  };
}

function fitAssets(answer: AssetSearchAnswer): AssetSearchAnswer {
  const assets = [...answer.assets];
  let complete = answer.complete;
  const rendered = () => JSON.stringify({ ...answer, assets, complete });
  while (rendered().length >= MAX_ASSET_JSON && assets.length > 0) {
    assets.pop();
    complete = false;
  }
  return { ...answer, assets, complete };
}
