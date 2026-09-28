import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import {
  MODEL_CHECK_TIMEOUT_MS,
  MODEL_ID_MAX_LENGTH,
  MODEL_LIST_MAX_LENGTH,
  modelsEndpoint,
  type CheckError,
  type ConnectionCheck,
} from '@lct/contracts';

/**
 * A check of a connection: a real `GET {baseUrl}/models`, as any OpenAI-compatible client does it.
 * It runs only here, so the key never reaches the browser, and "localhost" in an address means the
 * machine the API runs on.
 *
 * The address is typed by a person, and the API goes there with the key attached. Two rules keep
 * that from being turned against the server:
 *
 * - redirects are refused, so a server cannot bounce the request, and the key with it, elsewhere;
 * - an address inside a private network (loopback, 10/8, 172.16/12, 192.168/16, link-local with
 *   the cloud metadata service, unique-local IPv6) is refused unless `MODEL_ALLOW_PRIVATE_HOSTS`
 *   says local runtimes such as Ollama are expected. A name is resolved first, so a public name
 *   pointing at a private address is caught too.
 *
 * `fetch` and the resolver are injected: tests cover parsing and errors without a network.
 */

export const CHECK_TIMEOUT_MS = MODEL_CHECK_TIMEOUT_MS;

export type Resolve = (host: string) => Promise<readonly string[]>;

export interface CheckOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
  /** Whether addresses inside private networks may be used. */
  readonly allowPrivateHosts?: boolean;
  readonly resolve?: Resolve;
}

/** `MODEL_ALLOW_PRIVATE_HOSTS=true` lets connections point at loopback and private networks. */
export function privateHostsAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return /^(1|true|yes)$/i.test(env.MODEL_ALLOW_PRIVATE_HOSTS?.trim() ?? '');
}

const defaultResolve: Resolve = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/** Whether an IP address belongs to loopback, a private or link-local range, or is unspecified. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(ip) === 6) {
    return (
      ip === '::' || ip === '::1' || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip)
    );
  }
  return false;
}

/**
 * Whether the host of an address is private. A name that does not resolve is not called private:
 * the request will fail as unreachable, which is the more useful thing to tell.
 */
export async function isPrivateHost(baseUrl: string, resolve: Resolve = defaultResolve) {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (isIP(host) !== 0) return isPrivateAddress(host);
  try {
    return (await resolve(host)).some(isPrivateAddress);
  } catch {
    return false;
  }
}

/** The answer of `/models` in the OpenAI format: `{ object: 'list', data: [{ id, ... }] }`. */
const modelsResponseSchema = z.object({
  data: z.array(z.looseObject({ id: z.string() })),
});

/** Model ids of a `/models` answer in server order, without repeats or blanks; another format — null. */
export function parseModelsResponse(body: unknown): readonly string[] | null {
  const parsed = modelsResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  for (const item of parsed.data.data) {
    const id = item.id.trim();
    if (id === '' || id.length > MODEL_ID_MAX_LENGTH) continue;
    ids.add(id);
    if (ids.size >= MODEL_LIST_MAX_LENGTH) break;
  }
  return [...ids];
}

/**
 * The system error code, when there is one: Node puts it into `cause` of `fetch failed`
 * (`ECONNREFUSED`, `ENOTFOUND`). The message is not used: it can hold anything.
 */
export function unreachableDetail(error: unknown): string | null {
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : null;
  for (const candidate of [cause, error]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const code = (candidate as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  }
  return null;
}

class CheckTimeout extends Error {
  override readonly name = 'CheckTimeout';
}

/** Check a server at an address: the models found, or why it did not work. */
export async function checkModelConnection(
  target: { readonly baseUrl: string; readonly apiKey: string | null },
  options: CheckOptions = {},
): Promise<ConnectionCheck> {
  const run = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const fail = (error: CheckError): ConnectionCheck => ({
    ok: false,
    at: now().toISOString(),
    error,
  });

  if (!options.allowPrivateHosts && (await isPrivateHost(target.baseUrl, options.resolve))) {
    return fail({ kind: 'blocked' });
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timer covers both the connection and the body: a server that sent headers and went quiet
  // did not answer either. The race is for a `fetch` that ignores the signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeout());
    }, timeoutMs);
  });

  const headers: Record<string, string> = { accept: 'application/json' };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;

  const request = async () => {
    const response = await run(modelsEndpoint(target.baseUrl), {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    });
    if (response.status === 401 || response.status === 403) {
      return fail({ kind: 'unauthorized', status: response.status });
    }
    if (!response.ok) return fail({ kind: 'http', status: response.status });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail({ kind: 'invalid-response' });
    }
    const models = parseModelsResponse(body);
    if (models === null) return fail({ kind: 'invalid-response' });
    return { ok: true, at: now().toISOString(), models: [...models] } satisfies ConnectionCheck;
  };

  try {
    return await Promise.race([request(), timeout]);
  } catch (error) {
    if (error instanceof CheckTimeout || controller.signal.aborted)
      return fail({ kind: 'timeout' });
    return fail({ kind: 'unreachable', detail: unreachableDetail(error) });
  } finally {
    clearTimeout(timer);
  }
}
