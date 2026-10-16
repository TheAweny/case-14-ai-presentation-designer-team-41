import { API_PROXY_PATH, apiFetch } from './api';
import { proxiedApiPath } from './api-proxy';

/**
 * The API's OpenAPI document as the browser should read it. The API itself is not reachable from
 * outside: the browser calls it through this server's `/api/backend`, with its session, so that
 * is the one server the page offers. Routes the proxy does not forward are marked, so «Try it
 * out» on them is not a surprise 404.
 *
 * Module without Next or React: `browserDocument` is checked by tests.
 */

export const SERVER_ONLY_EXTENSION = 'x-lct-server-only';

const SERVER_ONLY_NOTE =
  '**Только для сервера веба.** Браузер этот маршрут через `/api/backend` не видит: его вызывают страницы и действия веб-сервера.';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Parameter {
  readonly name?: string;
  readonly in?: string;
  readonly example?: unknown;
  readonly schema?: { readonly example?: unknown };
}

interface Operation {
  description?: string;
  parameters?: readonly Parameter[];
  [SERVER_ONLY_EXTENSION]?: boolean;
}

export interface OpenApiDocument {
  servers?: { url: string; description?: string }[];
  paths?: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>>;
  [key: string]: unknown;
}

/** The path with each `{param}` filled by its example, as the browser would call it. */
function samplePath(path: string, operation: Operation): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const name = /^\{(.+)\}$/.exec(segment)?.[1];
      if (name === undefined) return segment;
      const parameter = operation.parameters?.find((p) => p.in === 'path' && p.name === name);
      const example = parameter?.example ?? parameter?.schema?.example;
      return typeof example === 'string' ? example : 'sample';
    });
}

export function browserDocument(document: OpenApiDocument): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const next: (typeof paths)[string] = { ...item };
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      if (proxiedApiPath(samplePath(path, operation), method) !== null) continue;
      next[method] = {
        ...operation,
        [SERVER_ONLY_EXTENSION]: true,
        description: [SERVER_ONLY_NOTE, operation.description].filter(Boolean).join('\n\n'),
      };
    }
    paths[path] = next;
  }
  return {
    ...document,
    servers: [{ url: API_PROXY_PATH, description: 'Через веб-сервер, с сессией этого браузера' }],
    paths,
  };
}

/** The document from the API, ready for the browser; null while the API is not answering. */
export async function fetchBrowserDocument(): Promise<OpenApiDocument | null> {
  const answer = await apiFetch('/docs-json', {}, { userId: null }).catch(() => null);
  if (!answer?.ok) return null;
  return browserDocument((await answer.json()) as OpenApiDocument);
}
