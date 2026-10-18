import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPublicWebAddress } from './web-address.js';

/**
 * Keyless search against an operator-configured SearXNG instance.
 * The query is only the `q` parameter. Result pages are leads, not evidence.
 */

const MAX_QUERY_LENGTH = 300;
const DEFAULT_LIMIT = 5;
const MIN_LIMIT = 1;
const MAX_LIMIT = 8;
const MAX_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 500;
const MAX_CANDIDATES = 40;
const MAX_URL_LENGTH = 2_000;
const MAX_ENGINES = 10;
const MAX_ENGINE_NAME = 100;
const MAX_ANSWER_JSON = 10_000;
const MAX_LICENSE_LENGTH = 200;

export type WebSearchCategory = 'general' | 'images';

export const SEARCH_TRUST = 'search-results-not-evidence' as const;

export type SearchTrust = typeof SEARCH_TRUST;

export type ResolveName = (host: string) => Promise<readonly string[]>;

export interface WebSearchOptions {
  readonly baseUrl: string;
  /** Defaults to general. `images` asks SearXNG for `categories=images`. */
  readonly category?: WebSearchCategory;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  readonly resolve?: ResolveName;
}

export interface WebSearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publishedAt: string | null;
  /** Present only for `category: 'images'`. The picture address, not fetched. */
  readonly imageUrl?: string;
  /** Present only for `category: 'images'`. Source `license` field, or `unknown`. */
  readonly license?: string;
}

export interface WebSearchAnswer {
  readonly query: string;
  readonly results: readonly WebSearchResult[];
  readonly searchedAt: string;
  readonly unresponsiveEngines: readonly string[];
  readonly complete: boolean;
  readonly trust: SearchTrust;
}

export type WebSearchFailureKind =
  | 'invalid-base'
  | 'invalid-query'
  | 'invalid-limit'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'redirect'
  | 'invalid-response'
  | 'too-large'
  | 'unreachable';

export class WebSearchError extends Error {
  override readonly name = 'WebSearchError';
  readonly status?: number;

  constructor(
    readonly kind: WebSearchFailureKind,
    message: string = kind,
    status?: number,
  ) {
    super(message);
    this.status = status;
  }
}

export interface WebSearch {
  search(query: string, signal: AbortSignal, limit?: number): Promise<WebSearchAnswer>;
}

const defaultResolve: ResolveName = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/** Trimmed `WEB_SEARCH_URL`, or null when search is switched off. */
export function webSearchBaseUrl(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env.WEB_SEARCH_URL?.trim() ?? '';
  return value === '' ? null : value;
}

export function createWebSearch(options: WebSearchOptions): WebSearch {
  const base = parseBase(options.baseUrl);
  const category = normalizeCategory(options.category);
  const run = options.fetch ?? fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const now = options.now ?? (() => new Date());
  const resolve = options.resolve ?? defaultResolve;

  return {
    async search(query, signal, limit = DEFAULT_LIMIT) {
      const text = normalizeQuery(query);
      const count = normalizeLimit(limit);
      if (signal.aborted) throw new WebSearchError('aborted');

      const endpoint = new URL('search', base);
      if (
        endpoint.protocol !== base.protocol ||
        endpoint.host !== base.host ||
        endpoint.username !== '' ||
        endpoint.password !== ''
      ) {
        throw new WebSearchError('invalid-base');
      }
      endpoint.search = '';
      endpoint.hash = '';
      endpoint.searchParams.set('q', text);
      endpoint.searchParams.set('format', 'json');
      if (category === 'images') endpoint.searchParams.set('categories', 'images');

      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectDeadline: (error: WebSearchError) => void = () => undefined;
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = reject;
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new WebSearchError(signal.aborted ? 'aborted' : 'timeout'));
        }, timeoutMs);
      });
      const onCallerAbort = () => {
        controller.abort();
        clearTimeout(timer);
        rejectDeadline(new WebSearchError('aborted'));
      };
      signal.addEventListener('abort', onCallerAbort, { once: true });
      if (signal.aborted) onCallerAbort();

      const ensureLive = (): void => {
        if (signal.aborted) throw new WebSearchError('aborted');
        if (timedOut || controller.signal.aborted) throw new WebSearchError('timeout');
      };

      const failFromSignal = (): WebSearchError => {
        if (signal.aborted) return new WebSearchError('aborted');
        if (timedOut || controller.signal.aborted) return new WebSearchError('timeout');
        return new WebSearchError('unreachable');
      };

      const perform = async (): Promise<WebSearchAnswer> => {
        ensureLive();
        let response: Response;
        try {
          response = await run(endpoint, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
          });
        } catch (error) {
          if (signal.aborted) throw new WebSearchError('aborted');
          if (timedOut || controller.signal.aborted) throw new WebSearchError('timeout');
          if (isRedirectError(error)) throw new WebSearchError('redirect');
          throw new WebSearchError('unreachable');
        }

        ensureLive();
        if (response.status >= 300 && response.status < 400) {
          throw new WebSearchError('redirect', 'redirect', response.status);
        }
        if (response.status < 200 || response.status >= 300) {
          throw new WebSearchError('http', 'http', response.status);
        }

        const bytes = await readBounded(response, controller.signal, failFromSignal);
        ensureLive();
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          throw new WebSearchError('invalid-response');
        }
        ensureLive();
        const parsed = parsePayload(payload);
        const results = await collectResults(parsed.results, count, resolve, ensureLive, category);
        ensureLive();
        return fitAnswer({
          query: text,
          results,
          searchedAt: now().toISOString(),
          unresponsiveEngines: parsed.unresponsiveEngines,
          complete: parsed.unresponsiveEngines.length === 0,
          trust: SEARCH_TRUST,
        });
      };

      const pending = perform();
      void pending.catch(() => undefined);
      try {
        return await Promise.race([pending, deadline]);
      } finally {
        clearTimeout(timer);
        controller.abort();
        signal.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

function parseBase(input: string): URL {
  if (typeof input !== 'string') throw new WebSearchError('invalid-base');
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WebSearchError('invalid-base');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebSearchError('invalid-base');
  }
  if (url.username !== '' || url.password !== '') throw new WebSearchError('invalid-base');
  url.search = '';
  url.hash = '';
  if (url.pathname === '') url.pathname = '/';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return MAX_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WebSearchError('invalid-base', 'invalid-timeout');
  }
  return Math.min(timeoutMs, MAX_TIMEOUT_MS);
}

function normalizeCategory(category: WebSearchCategory | undefined): WebSearchCategory {
  if (category === undefined || category === 'general') return 'general';
  if (category === 'images') return 'images';
  throw new WebSearchError('invalid-base');
}

function normalizeQuery(query: string): string {
  if (typeof query !== 'string') throw new WebSearchError('invalid-query');
  const text = query.trim();
  if (text.length === 0 || text.length > MAX_QUERY_LENGTH)
    throw new WebSearchError('invalid-query');
  return text;
}

function normalizeLimit(limit: number): number {
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < MIN_LIMIT ||
    limit > MAX_LIMIT
  ) {
    throw new WebSearchError('invalid-limit');
  }
  return limit;
}

function isRedirectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'RedirectError' || /redirect/i.test(error.message);
}

async function readBounded(
  response: Response,
  signal: AbortSignal,
  failFromSignal: () => WebSearchError,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || declared.length > 7 || Number(declared) > MAX_BODY_BYTES) {
      throw new WebSearchError('too-large');
    }
  }
  const body = response.body;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) throw failFromSignal();
    for (;;) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch {
        throw failFromSignal();
      }
      if (next.done) {
        if (signal.aborted) throw failFromSignal();
        break;
      }
      if (signal.aborted) throw failFromSignal();
      total += next.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WebSearchError('too-large');
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface ParsedPayload {
  readonly results: readonly unknown[];
  readonly unresponsiveEngines: readonly string[];
}

function parsePayload(payload: unknown): ParsedPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new WebSearchError('invalid-response');
  }
  const record = payload as { results?: unknown; unresponsive_engines?: unknown };
  if (!Array.isArray(record.results)) throw new WebSearchError('invalid-response');
  const engines = parseEngines(record.unresponsive_engines);
  return {
    results: record.results,
    unresponsiveEngines: engines,
  };
}

function parseEngines(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new WebSearchError('invalid-response');
  const names: string[] = [];
  for (const entry of value) {
    if (names.length >= MAX_ENGINES) break;
    if (!Array.isArray(entry) || entry.length < 2) throw new WebSearchError('invalid-response');
    const [name, reason] = entry;
    if (typeof name !== 'string' || typeof reason !== 'string') {
      throw new WebSearchError('invalid-response');
    }
    const trimmed = name.trim().slice(0, MAX_ENGINE_NAME);
    if (trimmed !== '' && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

async function collectResults(
  items: readonly unknown[],
  limit: number,
  resolve: ResolveName,
  ensureLive: () => void,
  category: WebSearchCategory,
): Promise<WebSearchResult[]> {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, MAX_CANDIDATES)) {
    if (results.length >= limit) break;
    ensureLive();
    const parsed = await parseItem(item, resolve, ensureLive, category);
    if (parsed === null || seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    results.push(parsed);
  }
  return results;
}

async function parseItem(
  item: unknown,
  resolve: ResolveName,
  ensureLive: () => void,
  category: WebSearchCategory,
): Promise<WebSearchResult | null> {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
  const record = item as {
    url?: unknown;
    title?: unknown;
    content?: unknown;
    publishedDate?: unknown;
    img_src?: unknown;
    license?: unknown;
  };
  if (typeof record.url !== 'string' || typeof record.title !== 'string') return null;
  if (category === 'general' && typeof record.content !== 'string') return null;
  if (category === 'images' && record.content !== undefined && typeof record.content !== 'string') {
    return null;
  }
  if (
    record.publishedDate !== undefined &&
    record.publishedDate !== null &&
    typeof record.publishedDate !== 'string'
  ) {
    return null;
  }
  ensureLive();
  const url = await publicUrl(record.url, resolve, ensureLive);
  if (url === null) return null;
  const title = bound(record.title, MAX_TITLE_LENGTH);
  if (title === '') return null;
  const result: WebSearchResult = {
    url,
    title,
    snippet: bound(typeof record.content === 'string' ? record.content : '', MAX_SNIPPET_LENGTH),
    publishedAt: publishedAt(record.publishedDate),
  };
  if (category !== 'images') return result;
  if (typeof record.img_src !== 'string') return null;
  const imageUrl = await publicUrl(record.img_src, resolve, ensureLive);
  if (imageUrl === null) return null;
  return {
    ...result,
    imageUrl,
    license: sourceLicense(record.license),
  };
}

function sourceLicense(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const text = value.trim();
  if (text === '' || text.length > MAX_LICENSE_LENGTH) return 'unknown';
  return text;
}

function fitAnswer(answer: WebSearchAnswer): WebSearchAnswer {
  const results = [...answer.results];
  let complete = answer.complete;
  const rendered = () => JSON.stringify({ ...answer, results, complete });
  while (rendered().length >= MAX_ANSWER_JSON && results.length > 0) {
    results.pop();
    complete = false;
  }
  return { ...answer, results, complete };
}

function bound(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : text.slice(0, max);
}

async function publicUrl(
  raw: string,
  resolve: ResolveName,
  ensureLive: () => void,
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  if (url.port !== '' && url.port !== defaultPort) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return null;
  url.hash = '';
  if (url.href.length > MAX_URL_LENGTH) return null;
  if (isIP(host) !== 0) {
    if (!isPublicWebAddress(host)) return null;
  } else {
    let addresses: readonly string[];
    try {
      ensureLive();
      addresses = await resolve(host);
    } catch {
      return null;
    }
    ensureLive();
    if (addresses.length === 0 || addresses.some((address) => !isPublicWebAddress(address)))
      return null;
  }
  return url.href;
}

function publishedAt(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const text = value.trim();
  if (text === '') return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) return calendar(Number(day[1]), Number(day[2]), Number(day[3])) ? text : null;
  const zoneless = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (zoneless) {
    return calendar(Number(zoneless[1]), Number(zoneless[2]), Number(zoneless[3])) &&
      clock(Number(zoneless[4]), Number(zoneless[5]), Number(zoneless[6]))
      ? text
      : null;
  }
  const zoned =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!zoned) return null;
  if (
    !calendar(Number(zoned[1]), Number(zoned[2]), Number(zoned[3])) ||
    !clock(Number(zoned[4]), Number(zoned[5]), Number(zoned[6]))
  ) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function calendar(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function clock(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}
