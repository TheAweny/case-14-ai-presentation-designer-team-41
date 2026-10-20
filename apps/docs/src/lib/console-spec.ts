/**
 * The published OpenAPI snapshot, rewritten for the docs console.
 * The page adds the session itself, so the service token and the account headers
 * are not fields a person is asked to type.
 */

const HIDDEN_HEADERS = new Set(['x-lct-service-token', 'x-lct-user', 'x-lct-session']);

interface Parameter {
  readonly in?: string;
  readonly name?: string;
}

interface Operation {
  readonly parameters?: readonly Parameter[];
  readonly security?: unknown;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly summary?: string;
  readonly [key: string]: unknown;
}

export interface ConsoleDocument {
  readonly servers?: readonly { url: string; description?: string }[];
  readonly paths?: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components?: { securitySchemes?: unknown; [key: string]: unknown };
  readonly security?: unknown;
  readonly [key: string]: unknown;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

export interface ConsoleOperation {
  readonly tag: string;
  readonly method: string;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
}

/** Tags and operations in the order of the snapshot, for the console's own contents list. */
export function consoleOutline(document: ConsoleDocument): readonly ConsoleOperation[] {
  const rows: ConsoleOperation[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;
      const tags = operation.tags;
      const tag = Array.isArray(tags) && typeof tags[0] === 'string' && tags[0] ? tags[0] : 'Прочее';
      const operationId =
        typeof operation.operationId === 'string' && operation.operationId
          ? operation.operationId
          : `${method}:${path}`;
      const summary =
        typeof operation.summary === 'string' && operation.summary ? operation.summary : path;
      rows.push({ tag, method: method.toUpperCase(), path, operationId, summary });
    }
  }
  return rows;
}

export function consoleDocument(document: ConsoleDocument, serverUrl: string): ConsoleDocument {
  const components = { ...(document.components ?? {}) };
  delete components.securitySchemes;
  const paths: Record<string, Record<string, Operation>> = {};
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const next: Record<string, Operation> = {};
    for (const [method, operation] of Object.entries(item)) {
      if (!operation || typeof operation !== 'object') continue;
      const parameters = operation.parameters?.filter(
        (parameter) =>
          parameter.in !== 'header' ||
          !parameter.name ||
          !HIDDEN_HEADERS.has(parameter.name.toLowerCase()),
      );
      next[method] = { ...operation, security: undefined, parameters };
    }
    paths[path] = next;
  }
  return {
    ...document,
    servers: [
      {
        url: serverUrl,
        description: 'Через приложение, от имени аккаунта в шапке документации',
      },
    ],
    components,
    paths,
    security: undefined,
  };
}
