import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  accountPolicySchema,
  accountUsageViewSchema,
  editorMediaPutRequestSchema,
  editorRevisionExportRequestSchema,
  editorSnapshotSaveRequestSchema,
  modelSettingsSchema,
  policyMetricSchema,
  roleAssignmentSchema,
  type AccountPolicy,
  type AccountUsageView,
  type EditorMediaRef,
  type EditorSnapshot,
  type EditorSnapshotSaveResponse,
  type ModelSettings,
} from '@lct/contracts';

const initialModels = (): ModelSettings => ({
  connections: [
    {
      connectionId: 'fixture',
      name: 'Test models',
      preset: 'custom',
      baseUrl: 'https://models.example.test/v1',
      hasKey: true,
      keyHint: null,
      managed: false,
      lastCheck: { ok: true, at: '2026-10-15T00:00:00Z', models: ['alpha', 'beta'] },
    },
  ],
  roles: [
    { role: 'writer', kind: 'model', connectionId: 'fixture', modelId: 'alpha' },
    { role: 'assistant', kind: 'model', connectionId: 'fixture', modelId: 'beta' },
    { role: 'planner', kind: 'unassigned' },
    { role: 'critic', kind: 'unassigned' },
    { role: 'vision', kind: 'unassigned' },
    { role: 'image', kind: 'disabled' },
  ],
});
let modelSettings = initialModels();
let accountRole: 'user' | 'admin' = 'user';
/** What probing found per model id; a test sets it, any model not set offers no choice. */
let capabilities = new Map<string, unknown>();
/** What the provider says about each model of the fixture connection; null — it says nothing. */
let details: Record<string, { kinds: string[] }> | null = null;
/** Kinds the person set by hand, as the API keeps them. */
let manualKinds: Record<string, string[]> = {};
let templates: unknown[] = [];
let projects: unknown[] = [];
/** Accounts `GET /users` returns. Tests replace the list with `POST /__set-users`. */
let users: unknown[] = [];
/** Optional limits keyed by scope id. `default` is the shared policy. */
const policies = new Map<string, AccountPolicy>();
const adminUsage = new Map<string, AccountUsageView | null>();
let generationDeck: { runId: string } | null = null;
/** Editor revisions of the generation deck for the one signed-in account, as `apps/api` keeps them. */
let editorRevisions: EditorSnapshot[] = [];
const editorMedia = new Map<string, { ref: EditorMediaRef; bytes: Buffer }>();
const editorSaves = new Map<string, { status: number; body: EditorSnapshotSaveResponse }>();
const editorExports = new Map<string, { revision: number; format: string }>();
/**
 * The next chat turn a test scripted: `head` streams one event every `everyMs`, the turn then
 * waits for `/__release-turn` and sends `tail`. Events get their `seq` here.
 */
let scriptedTurn: { head: object[]; tail: object[]; everyMs: number } | null = null;
let releaseTurn: (() => void) | null = null;
/** Original template bytes for GET /files/templates/:id/download. An unknown id is 404. */
const templateDownloads = new Map<
  string,
  { readonly fileName: string; readonly contentType: string; readonly body: Buffer }
>();

/** Only fixed test data. Browser chat requests are intercepted by each Playwright scenario. */
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/__reset-models') {
    accountRole = 'user';
    modelSettings = initialModels();
    capabilities = new Map();
    details = null;
    manualKinds = {};
    templates = [];
    projects = [];
    users = [];
    policies.clear();
    adminUsage.clear();
    generationDeck = null;
    templateDownloads.clear();
    editorRevisions = [];
    editorMedia.clear();
    editorSaves.clear();
    editorExports.clear();
    scriptedTurn = null;
    releaseTurn?.();
    releaseTurn = null;
    response.end('{}');
  } else if (request.url === '/__set-admin' && request.method === 'POST') {
    accountRole = 'admin';
    response.end('{}');
  } else if (request.url === '/__set-users' && request.method === 'POST') {
    await setUsers(request, response);
  } else if (request.url === '/users' && request.method === 'GET') {
    response.end(JSON.stringify(users));
  } else if (request.url === '/__set-admin-usage' && request.method === 'POST') {
    const values = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    for (const [id, value] of Object.entries(values))
      adminUsage.set(id, value === null ? null : accountUsageViewSchema.parse(value));
    answer(response, 200, {});
  } else if (request.url?.startsWith('/users/') && request.method === 'PATCH') {
    const id = decodeURIComponent(request.url.slice('/users/'.length));
    const patch = JSON.parse(await bodyOf(request)) as Record<string, unknown>;
    const entries = users as { id: string; email: string }[];
    const user = entries.find((item) => item.id === id);
    if (!user) answer(response, 404, { message: 'Account not found.' });
    else if (entries.some((item) => item.id !== id && item.email === patch.email))
      answer(response, 409, { message: 'Email already exists.' });
    else {
      Object.assign(user, patch);
      answer(response, 200, user);
    }
  } else if (
    (request.method === 'GET' || request.method === 'PUT') &&
    accountUsageId(request.url)
  ) {
    await accountUsage(request, response);
  } else if (request.url === '/__set-generation-deck' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    generationDeck = JSON.parse(body) as { runId: string };
    response.end('{}');
  } else if (
    generationDeck &&
    (request.url === `/generation/${generationDeck.runId}/deck` ||
      request.url === `/generation/${generationDeck.runId}/summary`)
  ) {
    response.end(JSON.stringify(generationDeck));
  } else if (request.url?.startsWith('/editor/decks/')) {
    await editor(request, response);
  } else if (request.url === '/__editor') {
    response.end(
      JSON.stringify({
        revisions: editorRevisions,
        media: [...editorMedia.values()].map(({ ref, bytes }) => ({
          ...ref,
          dataUrl: `data:${ref.contentType};base64,${bytes.toString('base64')}`,
        })),
        exports: [...editorExports].map(([exportId, item]) => ({ exportId, ...item })),
      }),
    );
  } else if (request.url === '/__set-turn' && request.method === 'POST') {
    scriptedTurn = JSON.parse(await bodyOf(request)) as typeof scriptedTurn;
    response.end('{}');
  } else if (request.url === '/__release-turn' && request.method === 'POST') {
    releaseTurn?.();
    response.end('{}');
  } else if (
    scriptedTurn &&
    request.method === 'POST' &&
    /^\/chats\/[\w-]+\/turns$/.test(request.url ?? '')
  ) {
    await streamTurn(request, response, scriptedTurn);
  } else if (request.url === '/__set-templates' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    templates = JSON.parse(body) as unknown[];
    response.end('{}');
  } else if (request.url === '/files/templates') {
    response.end(JSON.stringify(templates));
  } else if (request.url === '/__set-projects' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    projects = JSON.parse(body) as unknown[];
    response.end('{}');
  } else if (request.url === '/library/projects') {
    response.end(JSON.stringify(projects));
  } else if (request.url === '/__set-template-download' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const file = JSON.parse(body) as {
      id: string;
      fileName: string;
      contentType: string;
      bodyBase64: string;
    };
    templateDownloads.set(file.id, {
      fileName: file.fileName,
      contentType: file.contentType,
      body: Buffer.from(file.bodyBase64, 'base64'),
    });
    response.end('{}');
  } else if (request.url?.startsWith('/files/templates/') && request.url.endsWith('/download')) {
    const id = decodeURIComponent(
      request.url.slice('/files/templates/'.length, -'/download'.length),
    );
    const file = templateDownloads.get(id);
    if (!file) {
      response.statusCode = 404;
      response.end(JSON.stringify({ message: 'Template file is missing.' }));
    } else {
      const star = encodeURIComponent(file.fileName).replace(/['()*]/g, (character) => {
        return '%' + character.charCodeAt(0).toString(16).toUpperCase();
      });
      const ascii = /\.potx$/i.test(file.fileName) ? 'template.potx' : 'template.pptx';
      response.setHeader('content-type', file.contentType);
      response.setHeader(
        'content-disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${star}`,
      );
      response.end(file.body);
    }
  } else if (request.url === '/__set-models' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    modelSettings = modelSettingsSchema.parse(JSON.parse(body));
    response.end('{}');
  } else if (
    request.url === '/model-settings/connections/fixture/kinds' &&
    request.method === 'PUT'
  ) {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const { modelId, kinds } = JSON.parse(body) as { modelId: string; kinds: string[] | null };
    if (kinds === null) delete manualKinds[modelId];
    else manualKinds[modelId] = kinds;
    response.statusCode = 204;
    response.end();
  } else if (request.url === '/__kinds' && request.method === 'PUT') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const kinds = JSON.parse(body) as Record<string, string[]>;
    details = Object.fromEntries(Object.entries(kinds).map(([id, list]) => [id, { kinds: list }]));
    response.end('{}');
  } else if (request.url === '/__capabilities' && request.method === 'PUT') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const { modelId, reasoning } = JSON.parse(body) as { modelId: string; reasoning: unknown };
    capabilities.set(modelId, reasoning);
    response.end('{}');
  } else if (request.url?.startsWith('/model-settings/capabilities?')) {
    const modelId = new URL(request.url, 'http://fixture').searchParams.get('modelId') ?? '';
    response.end(
      JSON.stringify({
        reasoning: capabilities.get(modelId) ?? { toggle: null, levels: false },
        probed: true,
      }),
    );
  } else if (request.url === '/speech/model') {
    const speech = modelSettings.roles.find((item) => item.role === 'speech');
    response.end(JSON.stringify({ available: speech?.kind === 'model' }));
  } else if (request.url === '/model-settings/roles' && request.method === 'PUT') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const assignment = roleAssignmentSchema.parse(JSON.parse(body));
    const at = modelSettings.roles.findIndex((item) => item.role === assignment.role);
    modelSettings.roles =
      at >= 0
        ? modelSettings.roles.map((item) => (item.role === assignment.role ? assignment : item))
        : [...modelSettings.roles, assignment];
    response.statusCode = 204;
    response.end();
  } else if (request.url?.startsWith('/auth/accounts/'))
    // The account asked for, as the API answers a live session: `/api/service-status` checks the id.
    response.end(
      JSON.stringify({
        account: {
          id: decodeURIComponent(request.url.slice('/auth/accounts/'.length)),
          email: 'chat-e2e@example.test',
          name: 'Chat E2E',
          role: accountRole,
        },
      }),
    );
  else if (request.url === '/auth/accounts') response.end(JSON.stringify({ hasAccounts: true }));
  else if (request.url === '/model-settings')
    response.end(
      JSON.stringify({
        ...modelSettings,
        connections: modelSettings.connections.map((connection) => ({
          ...connection,
          manualKinds: { ...connection.manualKinds, ...manualKinds },
          lastCheck:
            details && connection.lastCheck?.ok
              ? { ...connection.lastCheck, details }
              : connection.lastCheck,
        })),
      }),
    );
  else if (request.url === '/speech/transcriptions' && request.method === 'POST') {
    // A real provider takes a moment: long enough for the composer to show it is transcribing.
    for await (const chunk of request) void chunk;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response.end(JSON.stringify({ text: 'Голос услышан' }));
  } else if (request.url?.startsWith('/health'))
    response.end(
      JSON.stringify({
        status: 'ok',
        service: request.url.endsWith('/engine')
          ? 'engine'
          : request.url.endsWith('/database')
            ? 'postgresql'
            : 'api',
        version: '1.0.0',
        uptimeSeconds: 1,
      }),
    );
  else response.end('[]');
});

/** Stable window so a view always satisfies `accountUsageViewSchema`. */
const USAGE_START = '1970-01-01T00:00:00.000Z';
const DEMO_STORAGE_BYTES = 48 * 1024 * 1024;

/**
 * `/account-usage/me` and `/account-usage/:id`. `me` is its own scope, the same shape as a user:
 * it inherits `default`. Scope `default` reports that policy as defaults, override and effective.
 */
function accountUsageId(url: string | undefined): string | null {
  if (!url) return null;
  const path = new URL(url, 'http://fixture').pathname;
  const match = /^\/account-usage\/([^/]+)$/.exec(path);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function usageView(scope: string): AccountUsageView {
  const own = policies.get(scope) ?? {};
  const shared = scope === 'default';
  const defaults = shared ? own : (policies.get('default') ?? {});
  const override = own;
  const effective: AccountPolicy = shared ? own : { ...defaults, ...override };
  return accountUsageViewSchema.parse({
    defaults,
    override,
    effective,
    storageBytes: DEMO_STORAGE_BYTES,
    metrics: policyMetricSchema.options.map((metric) => ({
      metric,
      limit: effective[metric] ?? null,
      start: USAGE_START,
      end: null,
      completed: metric === 'generation' ? 3 : 0,
      active: metric === 'concurrency' ? 1 : 0,
    })),
  });
}

async function setUsers(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await bodyOf(request));
  } catch {
    answer(response, 400, { message: 'Invalid JSON.' });
    return;
  }
  if (!Array.isArray(body)) {
    answer(response, 400, { message: 'Expected a user array.' });
    return;
  }
  users = body;
  answer(response, 200, {});
}

async function accountUsage(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const id = accountUsageId(request.url);
  if (!id) {
    answer(response, 404, { message: 'Not found.' });
    return;
  }
  if (request.method === 'GET') {
    if (adminUsage.has(id)) {
      const view = adminUsage.get(id);
      answer(response, view ? 200 : 503, view ?? { message: 'Usage unavailable.' });
      return;
    }
    answer(response, 200, usageView(id));
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await bodyOf(request));
  } catch {
    answer(response, 400, { message: 'Invalid JSON.' });
    return;
  }
  const parsed = accountPolicySchema.safeParse(body);
  if (!parsed.success) {
    answer(response, 400, { message: parsed.error.message });
    return;
  }
  policies.set(id, parsed.data);
  answer(response, 200, usageView(id));
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
}

function answer(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

/** Streams a turn the way `ChatsController` does: headers first, then one SSE frame per event. */
async function streamTurn(
  request: IncomingMessage,
  response: ServerResponse,
  turn: NonNullable<typeof scriptedTurn>,
): Promise<void> {
  await bodyOf(request);
  scriptedTurn = null;
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
  });
  let seq = 0;
  const send = (event: object) =>
    response.write(`data: ${JSON.stringify({ ...event, seq: seq++ })}\n\n`);
  // A release that comes while `head` still streams is kept: `tail` follows right after it.
  const released = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  for (const event of turn.head) {
    send(event);
    await new Promise((resolve) => setTimeout(resolve, turn.everyMs));
  }
  await released;
  releaseTurn = null;
  for (const event of turn.tail) send(event);
  response.end();
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * `/editor/decks/:deckId/...` of `apps/api/src/editor`: revisioned snapshots of the generation
 * deck, their pictures and exports of one stored revision. Another deck is not this account's.
 */
async function editor(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '', 'http://fixture').pathname;
  const match = /^\/editor\/decks\/([\w-]+)\/(.+)$/.exec(path);
  if (!match || !generationDeck || match[1] !== generationDeck.runId) {
    answer(response, 404, { message: 'Completed deck not found.' });
    return;
  }
  const [, deckId, rest] = match as unknown as [string, string, string];
  const head = editorRevisions.at(-1) ?? null;
  if (rest === 'snapshot' && request.method === 'GET') {
    answer(response, 200, { schemaVersion: 1, snapshot: head });
  } else if (rest === 'snapshot' && request.method === 'POST') {
    const parsed = editorSnapshotSaveRequestSchema.safeParse(JSON.parse(await bodyOf(request)));
    if (!parsed.success) return answer(response, 400, { message: parsed.error.message });
    const save = parsed.data;
    const prior = editorSaves.get(save.idempotencyKey);
    if (prior) return answer(response, prior.status, prior.body);
    const missing = save.media.some((item) => {
      const stored = editorMedia.get(item.mediaPart);
      return !stored || stored.ref.sha256 !== item.sha256 || stored.bytes.length !== item.byteSize;
    });
    if (missing) {
      return answer(response, 409, {
        message: 'Нужные картинки ещё не записаны. Снимок не опубликован.',
      });
    }
    const current = head?.revision ?? 0;
    if (current !== save.expectedRevision) {
      if (!head) return answer(response, 409, { message: 'Нет редакции, которую ожидал клиент.' });
      const body: EditorSnapshotSaveResponse = {
        schemaVersion: 1,
        kind: 'conflict',
        conflict: {
          schemaVersion: 1,
          conflictId: randomUUID(),
          expectedRevision: save.expectedRevision,
          server: head,
          rejected: { base: save.base, slides: save.slides, media: save.media },
        },
      };
      editorSaves.set(save.idempotencyKey, { status: 409, body });
      return answer(response, 409, body);
    }
    const snapshot: EditorSnapshot = {
      schemaVersion: 1,
      deckId,
      revision: current + 1,
      base: save.base,
      savedAt: new Date().toISOString(),
      contentSha256: sha256(JSON.stringify(save.slides)),
      slides: save.slides,
      media: save.media,
    };
    editorRevisions.push(snapshot);
    const body: EditorSnapshotSaveResponse = { schemaVersion: 1, kind: 'saved', snapshot };
    editorSaves.set(save.idempotencyKey, { status: 200, body });
    answer(response, 200, body);
  } else if (rest === 'media' && request.method === 'POST') {
    const parsed = editorMediaPutRequestSchema.safeParse(JSON.parse(await bodyOf(request)));
    const data = parsed.success
      ? /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(parsed.data.dataUrl)
      : null;
    if (!parsed.success || !data) {
      return answer(response, 400, { message: 'Invalid editor media.' });
    }
    const { mediaPart } = parsed.data;
    const bytes = Buffer.from(data[2] ?? '', 'base64');
    const stored = editorMedia.get(mediaPart);
    if (stored && stored.ref.sha256 !== sha256(bytes)) {
      return answer(response, 409, { message: 'Эта картинка уже сохранена с другими байтами.' });
    }
    const ref: EditorMediaRef = stored?.ref ?? {
      mediaPart,
      sha256: sha256(bytes),
      byteSize: bytes.length,
      contentType: data[1] as EditorMediaRef['contentType'],
    };
    editorMedia.set(mediaPart, { ref, bytes });
    answer(response, 201, { schemaVersion: 1, media: ref });
  } else if (rest.startsWith('media/') && request.method === 'GET') {
    const stored = editorMedia.get(decodeURIComponent(rest.slice('media/'.length)));
    if (!stored) return answer(response, 404, { message: 'Picture not found.' });
    response.setHeader('content-type', stored.ref.contentType);
    response.end(stored.bytes);
  } else if (/^revisions\/\d+\/export$/.test(rest) && request.method === 'POST') {
    const parsed = editorRevisionExportRequestSchema.safeParse(JSON.parse(await bodyOf(request)));
    if (!parsed.success) return answer(response, 400, { message: parsed.error.message });
    const revision = Number(rest.split('/')[1]);
    const snapshot = editorRevisions.find((item) => item.revision === revision);
    if (!snapshot) return answer(response, 404, { message: 'Revision not found.' });
    const exportId = randomUUID();
    editorExports.set(exportId, { revision, format: parsed.data.format });
    answer(response, 201, {
      schemaVersion: 1,
      exportId,
      revision,
      contentSha256: snapshot.contentSha256,
      previews: [],
    });
  } else if (/^exports\/[\w-]+\/deck\.pptx$/.test(rest) && request.method === 'GET') {
    const exported = editorExports.get(rest.split('/')[1] ?? '');
    if (!exported) return answer(response, 404, { message: 'Artifact not found.' });
    response.setHeader(
      'content-type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    response.setHeader('content-disposition', 'attachment; filename="deck.pptx"');
    response.end(`fixture export of revision ${exported.revision}`);
  } else {
    answer(response, 404, { message: 'Not found.' });
  }
}

server.listen(3121, '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
