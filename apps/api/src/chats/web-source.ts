import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { isPublicWebAddress } from './web-address.js';

/**
 * Reads a public http(s) page for the chat. The connection is pinned to an address that
 * already passed the public-address check, so the request does not resolve the name again.
 * The original host is kept for the Host header and the TLS certificate.
 */

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const MAX_BYTES = 1024 * 1024;
const MAX_CHARS = 8_000;
const MAX_TITLE = 200;
const DEADLINE_MS = 12_000;
const MAX_JSON = 10_000;
const TRUST = 'unverified' as const;

export type WebSourceTrust = typeof TRUST;
export type ResolveName = (host: string) => Promise<readonly string[]>;

export interface WebSourceResponse {
  readonly status: number;
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
}

export interface WebSourceTransport {
  request(url: URL, pinnedAddress: string, signal: AbortSignal): Promise<WebSourceResponse>;
}

export interface WebSourceOptions {
  readonly resolve?: ResolveName;
  readonly transport?: WebSourceTransport;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly offset?: number;
  readonly maxChars?: number;
  readonly expectedContentHash?: string;
}

export interface WebSourcePage {
  readonly requestedUrl: string;
  readonly url: string;
  readonly title: string | null;
  readonly text: string;
  readonly fetchedAt: string;
  readonly contentHash: string;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly truncated: boolean;
  readonly trust: WebSourceTrust;
}

export type WebSourceFailureKind =
  | 'invalid-url'
  | 'blocked'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'redirect'
  | 'too-large'
  | 'unsupported'
  | 'hash-mismatch'
  | 'unreachable';

export class WebSourceError extends Error {
  override readonly name = 'WebSourceError';
  readonly status?: number;

  constructor(
    readonly kind: WebSourceFailureKind,
    message: string = kind,
    status?: number,
  ) {
    super(message);
    this.status = status;
  }
}

const defaultResolve: ResolveName = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

export function fetchWebSource(
  input: string,
  signal: AbortSignal,
  options: WebSourceOptions = {},
): Promise<WebSourcePage> {
  const requested = parsePageUrl(input);
  const offset = normalizeOffset(options.offset);
  const maxChars = normalizeMaxChars(options.maxChars);
  const expected = normalizeHash(options.expectedContentHash);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const resolve = options.resolve ?? defaultResolve;
  const transport = options.transport ?? nodeTransport();
  const now = options.now ?? (() => new Date());
  if (signal.aborted) return Promise.reject(new WebSourceError('aborted'));

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectDeadline: (error: WebSourceError) => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new WebSourceError(signal.aborted ? 'aborted' : 'timeout'));
    }, timeoutMs);
  });
  const onCallerAbort = () => {
    controller.abort();
    clearTimeout(timer);
    rejectDeadline(new WebSourceError('aborted'));
  };
  signal.addEventListener('abort', onCallerAbort, { once: true });
  if (signal.aborted) onCallerAbort();

  const ensureLive = (): void => {
    if (signal.aborted) throw new WebSourceError('aborted');
    if (timedOut || controller.signal.aborted) throw new WebSourceError('timeout');
  };

  const perform = async (): Promise<WebSourcePage> => {
    let current = requested;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      ensureLive();
      const pinned = await pinAddress(current, resolve, ensureLive);
      ensureLive();
      let response: WebSourceResponse;
      try {
        response = await transport.request(current, pinned, controller.signal);
      } catch (error) {
        if (signal.aborted) throw new WebSourceError('aborted');
        if (timedOut || controller.signal.aborted) throw new WebSourceError('timeout');
        throw new WebSourceError(
          'unreachable',
          error instanceof Error ? error.message : 'unreachable',
        );
      }
      ensureLive();
      if (response.status >= 300 && response.status < 400) {
        const location = headerValue(response.headers, 'location');
        await disposeBody(response.body);
        if (hop === MAX_REDIRECTS || location === null) {
          throw new WebSourceError('redirect', 'redirect', response.status);
        }
        current = parsePageUrl(resolveRedirect(location, current));
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        await disposeBody(response.body);
        throw new WebSourceError('http', 'http', response.status);
      }
      try {
        assertReadable(response.headers);
        const declared = headerValue(response.headers, 'content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
          throw new WebSourceError('too-large');
        }
        const bytes = await readLimited(response.body, ensureLive);
        ensureLive();
        const type = headerValue(response.headers, 'content-type');
        const decoded = decodeBytes(bytes, type);
        const cleaned = cleanDocument(decoded, type);
        if (expected !== null && expected !== cleaned.hash)
          throw new WebSourceError('hash-mismatch');
        return fitPage({
          requestedUrl: requested.href,
          url: current.href,
          title: cleaned.title,
          fullText: cleaned.text,
          fetchedAt: now().toISOString(),
          contentHash: cleaned.hash,
          offset,
          maxChars,
        });
      } catch (error) {
        await disposeBody(response.body);
        throw error;
      }
    }
    throw new WebSourceError('redirect');
  };

  const pending = perform();
  void pending.catch(() => undefined);
  return Promise.race([pending, deadline]).finally(() => {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', onCallerAbort);
  });
}

function nodeTransport(): WebSourceTransport {
  return {
    request(url, pinnedAddress, signal) {
      const family = isIP(pinnedAddress) === 6 ? 6 : 4;
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const options = {
        method: 'GET' as const,
        autoSelectFamily: false,
        servername: isIP(host) === 0 ? host : undefined,
        lookup: (
          _hostname: string,
          _options: unknown,
          callback: (err: Error | null, address: string, family: number) => void,
        ) => {
          callback(null, pinnedAddress, family);
        },
        headers: {
          accept: 'text/html, text/plain;q=0.9',
          'accept-encoding': 'identity',
          host: url.host,
        },
        signal,
      };
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      return new Promise((resolve, reject) => {
        const req = send(url, options as RequestOptions, (message: IncomingMessage) => {
          resolve({ status: message.statusCode ?? 0, headers: message.headers, body: message });
        });
        req.once('error', reject);
        req.end();
      });
    },
  };
}

async function pinAddress(url: URL, resolve: ResolveName, ensureLive: () => void): Promise<string> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) {
    throw new WebSourceError('blocked');
  }
  if (isIP(host) !== 0) {
    if (!isPublicWebAddress(host)) throw new WebSourceError('blocked');
    return host;
  }
  ensureLive();
  let addresses: readonly string[];
  try {
    addresses = await resolve(host);
  } catch (error) {
    if (error instanceof WebSourceError) throw error;
    throw new WebSourceError('unreachable');
  }
  ensureLive();
  if (addresses.length === 0 || addresses.some((address) => !isPublicWebAddress(address))) {
    throw new WebSourceError('blocked');
  }
  return addresses[0] ?? host;
}

function parsePageUrl(input: string): URL {
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > MAX_URL_LENGTH) {
    throw new WebSourceError('invalid-url');
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new WebSourceError('invalid-url');
  }
  if (url.href.length > MAX_URL_LENGTH) throw new WebSourceError('invalid-url');
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new WebSourceError('invalid-url');
  if (url.username !== '' || url.password !== '') throw new WebSourceError('invalid-url');
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  if (url.port !== '' && url.port !== defaultPort) throw new WebSourceError('invalid-url');
  url.hash = '';
  return url;
}

function resolveRedirect(location: string, current: URL): string {
  try {
    return new URL(location, current).href;
  } catch {
    throw new WebSourceError('redirect');
  }
}

function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined) return 0;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new WebSourceError('invalid-url', 'invalid-offset');
  }
  return offset;
}

function normalizeMaxChars(maxChars: number | undefined): number {
  if (maxChars === undefined) return MAX_CHARS;
  if (
    typeof maxChars !== 'number' ||
    !Number.isInteger(maxChars) ||
    maxChars < 1 ||
    maxChars > MAX_CHARS
  ) {
    throw new WebSourceError('invalid-url', 'invalid-max-chars');
  }
  return maxChars;
}

function normalizeHash(hash: string | undefined): string | null {
  if (hash === undefined) return null;
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))
    throw new WebSourceError('hash-mismatch');
  return hash.toLowerCase();
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEADLINE_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new WebSourceError('invalid-url', 'invalid-timeout');
  }
  return Math.min(timeoutMs, DEADLINE_MS);
}

function headerValue(headers: WebSourceResponse['headers'], name: string): string | null {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const value = headers.get(name);
    return value === null || value.trim() === '' ? null : value.trim();
  }
  const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const found = Object.entries(record).find(([key]) => key.toLowerCase() === name);
  const value = found?.[1];
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item) => item.trim() !== '');
    return first === undefined ? null : first.trim();
  }
  return null;
}

function assertReadable(headers: WebSourceResponse['headers']): void {
  const encoding = headerValue(headers, 'content-encoding');
  if (encoding !== null && encoding.toLowerCase() !== 'identity')
    throw new WebSourceError('unsupported');
  const type = headerValue(headers, 'content-type');
  const media = type?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (media !== 'text/plain' && media !== 'text/html') throw new WebSourceError('unsupported');
}

async function readLimited(
  body: AsyncIterable<Uint8Array>,
  ensureLive: () => void,
): Promise<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      ensureLive();
      const next = await iterator.next();
      if (next.done) break;
      const value = next.value;
      if (!(value instanceof Uint8Array)) throw new WebSourceError('unsupported');
      total += value.byteLength;
      if (total > MAX_BYTES) throw new WebSourceError('too-large');
      chunks.push(value);
    }
  } catch (error) {
    await iterator.return?.().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return bytes;
}

async function disposeBody(body: AsyncIterable<Uint8Array>): Promise<void> {
  const iterator = body[Symbol.asyncIterator]();
  await iterator.return?.().catch(() => undefined);
  const closable = body as AsyncIterable<Uint8Array> & { destroy?: () => void };
  closable.destroy?.();
}

function decodeBytes(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([^";]+)/i
    .exec(contentType ?? '')?.[1]
    ?.trim()
    .toLowerCase();
  const label = charset === undefined || charset === '' || charset === 'utf8' ? 'utf-8' : charset;
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    throw new WebSourceError('unsupported');
  }
}

function cleanDocument(
  text: string,
  contentType: string | null,
): { title: string | null; text: string; hash: string } {
  const media = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const cleaned =
    media === 'text/html'
      ? htmlToText(text)
      : { title: null, text: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') };
  return { ...cleaned, hash: createHash('sha256').update(cleaned.text, 'utf8').digest('hex') };
}

function htmlToText(source: string): { title: string | null; text: string } {
  const withoutDanger = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ');
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(withoutDanger);
  const rawTitle = titleMatch?.[1];
  const title =
    rawTitle === undefined
      ? null
      : clip(collapse(decodeEntities(rawTitle.replace(/<[^>]*>/g, ' '))), MAX_TITLE);
  const body = withoutDanger
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return { title: title === '' ? null : title, text: collapse(decodeEntities(body)) };
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity) => {
    const body = entity.slice(1, -1);
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        !Number.isInteger(code) ||
        code < 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return entity;
      }
      return String.fromCodePoint(code);
    }
    const named: Readonly<Record<string, string>> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    return named[body.toLowerCase()] ?? entity;
  });
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function fitPage(input: {
  requestedUrl: string;
  url: string;
  title: string | null;
  fullText: string;
  fetchedAt: string;
  contentHash: string;
  offset: number;
  maxChars: number;
}): WebSourcePage {
  let start = Math.min(input.offset, input.fullText.length);
  if (start > 0 && start < input.fullText.length && lowSurrogate(input.fullText.charCodeAt(start)))
    start += 1;
  let end = Math.min(input.fullText.length, start + input.maxChars);
  end = retreatSurrogate(input.fullText, start, end);
  let text = input.fullText.slice(start, end);
  let title = input.title;
  const render = (): WebSourcePage => ({
    requestedUrl: input.requestedUrl,
    url: input.url,
    title,
    text,
    fetchedAt: input.fetchedAt,
    contentHash: input.contentHash,
    offset: start,
    nextOffset: end < input.fullText.length ? end : null,
    truncated: end < input.fullText.length,
    trust: TRUST,
  });
  while (JSON.stringify(render()).length >= MAX_JSON && text.length > 0) {
    text = text.slice(0, -1);
    if (text.length > 0 && highSurrogate(text.charCodeAt(text.length - 1)))
      text = text.slice(0, -1);
    end = start + text.length;
  }
  while (title !== null && JSON.stringify(render()).length >= MAX_JSON) {
    title = title.slice(0, -1);
    if (title.length > 0 && highSurrogate(title.charCodeAt(title.length - 1)))
      title = title.slice(0, -1);
    if (title === '') title = null;
  }
  return render();
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  return highSurrogate(cut.charCodeAt(cut.length - 1)) ? cut.slice(0, -1) : cut;
}

function retreatSurrogate(text: string, start: number, end: number): number {
  if (end <= start || end >= text.length) return end;
  if (highSurrogate(text.charCodeAt(end - 1)) && lowSurrogate(text.charCodeAt(end))) return end - 1;
  return end;
}

function highSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function lowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
