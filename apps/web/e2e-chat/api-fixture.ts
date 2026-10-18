import { createServer } from 'node:http';
import { modelSettingsSchema, roleAssignmentSchema, type ModelSettings } from '@lct/contracts';

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
/** What probing found per model id; a test sets it, any model not set offers no choice. */
let capabilities = new Map<string, unknown>();
/** What the provider says about each model of the fixture connection; null — it says nothing. */
let details: Record<string, { kinds: string[] }> | null = null;
/** Kinds the person set by hand, as the API keeps them. */
let manualKinds: Record<string, string[]> = {};
let templates: unknown[] = [];

/** Only fixed test data. Browser chat requests are intercepted by each Playwright scenario. */
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/__reset-models') {
    modelSettings = initialModels();
    capabilities = new Map();
    details = null;
    manualKinds = {};
    templates = [];
    response.end('{}');
  } else if (request.url === '/__set-templates' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    templates = JSON.parse(body) as unknown[];
    response.end('{}');
  } else if (request.url === '/files/templates') {
    response.end(JSON.stringify(templates));
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
    response.end(
      JSON.stringify({
        account: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'chat-e2e@example.test',
          name: 'Chat E2E',
          role: 'user',
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
          manualKinds,
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
server.listen(3121, '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
