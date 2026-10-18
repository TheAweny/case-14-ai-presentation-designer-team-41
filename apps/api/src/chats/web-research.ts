import { createHash } from 'node:crypto';
import {
  materialResearchSourceSchema,
  type MaterialResearchResult,
  type MaterialResearchSource,
} from '@lct/contracts';
import type { WebSearchAnswer, WebSearchResult } from './web-search.js';
import type { WebSourcePage } from './web-source.js';

/**
 * One search and up to three page reads for a chat question.
 * The model step is injected by the caller. This module never calls a model or the network itself.
 * Quotes from the child are kept only when they are exact substrings of a fetched page.
 */

const MAX_QUESTION = 1000;
const MAX_SEARCH_QUERY = 300;
const MAX_PAGES = 3;
const MAX_TEXT = 8_000;
const MAX_NAME = 300;
const MAX_QUOTE = 1000;
const MAX_EVIDENCE = 3;
const MAX_OPEN_QUESTIONS = 5;
const MAX_OPEN_QUESTION = 300;
const MAX_FAILURES = 3;
const MAX_ERROR = 200;
const MAX_JSON = 10_000;

export interface WebResearchCallbacks {
  readonly search: (query: string, signal: AbortSignal, limit: number) => Promise<WebSearchAnswer>;
  readonly fetch: (url: string, signal: AbortSignal) => Promise<WebSourcePage>;
  readonly run: (
    question: string,
    sources: readonly MaterialResearchSource[],
    signal: AbortSignal,
  ) => Promise<MaterialResearchResult>;
}

export interface WebResearchEvidence {
  readonly url: string;
  readonly title: string | null;
  readonly quote: string;
  readonly start: number;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly support: 'unverified';
}

export interface WebResearchFailure {
  readonly url: string;
  readonly message: string;
}

export interface WebResearchCoverage {
  readonly url: string;
  readonly offset: number;
  readonly readChars: number;
  readonly truncated: boolean;
  readonly nextOffset: number | null;
  readonly contentHash: string;
}

export interface WebResearchResult {
  readonly outputTruncated: boolean;
  readonly searchedQuery: string;
  readonly complete: boolean;
  readonly unresponsiveEngines: readonly string[];
  readonly summary: string;
  readonly evidence: readonly WebResearchEvidence[];
  readonly openQuestions: readonly string[];
  readonly failures: readonly WebResearchFailure[];
  readonly coverage: readonly WebResearchCoverage[];
  readonly manifest: MaterialResearchResult['manifest'] | null;
}

export type WebResearchFailureKind = 'invalid-question' | 'aborted' | 'too-large';

export class WebResearchError extends Error {
  override readonly name = 'WebResearchError';

  constructor(
    readonly kind: WebResearchFailureKind,
    message: string = kind,
  ) {
    super(message);
  }
}

interface FetchedPage {
  readonly requestedUrl: string;
  readonly page: WebSourcePage;
  readonly source: MaterialResearchSource;
}

/** Stable UUID derived from the page URL. Version and variant bits make it a valid v4 UUID. */
export function webSourceId(url: string): string {
  const bytes = createHash('sha256').update(url, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export async function researchWebTopic(
  question: string,
  callbacks: WebResearchCallbacks,
  signal: AbortSignal,
): Promise<WebResearchResult> {
  const text = normalizeQuestion(question);
  const searchedQuery = bound(text, MAX_SEARCH_QUERY);
  halt(signal);
  const found = await callbacks.search(searchedQuery, signal, MAX_PAGES);
  halt(signal);
  const pages: FetchedPage[] = [];
  const failures: WebResearchFailure[] = [];
  for (const url of uniqueUrls(found.results)) {
    halt(signal);
    try {
      const page = await callbacks.fetch(url, signal);
      halt(signal);
      pages.push(toSource(url, page));
    } catch (error) {
      if (aborted(error, signal)) throw new WebResearchError('aborted');
      if (failures.length < MAX_FAILURES) {
        failures.push({
          url,
          message: bound(error instanceof Error ? error.message : 'fetch-failed', MAX_ERROR),
        });
      }
    }
  }
  halt(signal);
  const shared = {
    searchedQuery,
    complete: found.complete,
    unresponsiveEngines: [...found.unresponsiveEngines],
    coverage: coverageOf(pages),
  };
  if (pages.length === 0) {
    return pack({
      evidence: [],
      openQuestions: ['Не удалось прочитать ни одну страницу по этому вопросу.'],
      failures,
      manifest: null,
      ...shared,
    });
  }
  const child = await callbacks.run(
    text,
    pages.map((item) => item.source),
    signal,
  );
  halt(signal);
  return pack({
    ...checked(child, pages),
    failures,
    manifest: child.manifest,
    ...shared,
  });
}

function checked(
  child: MaterialResearchResult,
  pages: readonly FetchedPage[],
): { evidence: WebResearchEvidence[]; openQuestions: string[] } {
  const evidence: WebResearchEvidence[] = [];
  let rejected = false;
  for (const item of child.evidence) {
    if (evidence.length >= MAX_EVIDENCE) break;
    const owner = pages.find((page) => page.source.sourceId === item.sourceId);
    const local = owner?.source.text.indexOf(item.quote) ?? -1;
    const start = owner && local >= 0 ? (owner.source.offset ?? 0) + local : -1;
    if (
      !owner ||
      item.quote.length === 0 ||
      item.quote.length > MAX_QUOTE ||
      !item.quote.trim() ||
      start < 0 ||
      item.start !== start
    ) {
      rejected = true;
      continue;
    }
    if (evidence.some((kept) => kept.url === owner.page.url && kept.quote === item.quote)) continue;
    evidence.push({
      url: owner.page.url,
      title: owner.page.title,
      quote: item.quote,
      start,
      fetchedAt: owner.page.fetchedAt,
      contentHash: owner.page.contentHash,
      support: 'unverified',
    });
  }
  const openQuestions = child.openQuestions.filter(
    (item) => item.trim().length > 0 && item.trim().length <= MAX_OPEN_QUESTION,
  );
  if (evidence.length === 0) {
    openQuestions.push('Исследователь не вернул проверяемую цитату для ответа.');
  }
  if (rejected) {
    openQuestions.push('Часть цитат исследователя не найдена в прочитанных страницах и отброшена.');
  }
  return { evidence, openQuestions: openQuestions.slice(0, MAX_OPEN_QUESTIONS) };
}

function toSource(requestedUrl: string, page: WebSourcePage): FetchedPage {
  const text = bound(page.text, MAX_TEXT);
  const name = bound(page.title?.trim() || page.url || requestedUrl, MAX_NAME);
  const source = materialResearchSourceSchema.parse({
    sourceId: webSourceId(requestedUrl),
    name,
    text,
    offset: page.offset,
    truncated: page.truncated || text.length !== page.text.length,
  });
  return { requestedUrl, page, source };
}

function uniqueUrls(results: readonly WebSearchResult[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (urls.length >= MAX_PAGES) break;
    const url = result.url.trim();
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function pack(input: {
  evidence: readonly WebResearchEvidence[];
  openQuestions: readonly string[];
  failures: readonly WebResearchFailure[];
  searchedQuery: string;
  complete: boolean;
  unresponsiveEngines: readonly string[];
  coverage: readonly WebResearchCoverage[];
  manifest: MaterialResearchResult['manifest'] | null;
}): WebResearchResult {
  const evidence = [...input.evidence];
  const openQuestions = [...input.openQuestions];
  const failures = [...input.failures];
  const unresponsiveEngines = [...input.unresponsiveEngines];
  const coverage = [...input.coverage];
  let outputTruncated = false;
  const render = (): WebResearchResult => ({
    outputTruncated,
    searchedQuery: input.searchedQuery,
    complete: input.complete,
    unresponsiveEngines,
    summary: evidence.map((item) => item.quote).join('\n'),
    evidence,
    openQuestions,
    failures,
    coverage,
    manifest: input.manifest,
  });
  while (JSON.stringify(render()).length >= MAX_JSON) {
    outputTruncated = true;
    if (evidence.length > 0) evidence.pop();
    else if (openQuestions.length > 0) openQuestions.pop();
    else if (failures.length > 0) failures.pop();
    else if (unresponsiveEngines.length > 0) unresponsiveEngines.pop();
    else if (coverage.length > 0) coverage.pop();
    else throw new WebResearchError('too-large');
  }
  return render();
}

function coverageOf(pages: readonly FetchedPage[]): WebResearchCoverage[] {
  return pages.slice(0, MAX_PAGES).map((item) => {
    const offset = item.source.offset ?? 0;
    const readChars = item.source.text.length;
    const truncated = item.source.truncated;
    return {
      url: item.page.url,
      offset,
      readChars,
      truncated,
      nextOffset: truncated ? offset + readChars : null,
      contentHash: item.page.contentHash,
    };
  });
}

function normalizeQuestion(question: string): string {
  if (typeof question !== 'string') throw new WebResearchError('invalid-question');
  const text = question.trim();
  if (text.length === 0 || text.length > MAX_QUESTION)
    throw new WebResearchError('invalid-question');
  return text;
}

function bound(value: string, max: number): string {
  const cut = value.length <= max ? value : value.slice(0, max);
  return highSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

function highSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function halt(signal: AbortSignal): void {
  if (signal.aborted) throw new WebResearchError('aborted');
}

function aborted(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof WebResearchError && error.kind === 'aborted';
}
