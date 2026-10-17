import { createServer } from 'node:http';
import { roleAssignmentSchema, type ModelSettings } from '@lct/contracts';

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

/** Only fixed test data. Browser chat requests are intercepted by each Playwright scenario. */
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url === '/__reset-models') {
    modelSettings = initialModels();
    response.end('{}');
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
  else if (request.url === '/model-settings') response.end(JSON.stringify(modelSettings));
  else if (request.url === '/speech/transcriptions' && request.method === 'POST')
    response.end(JSON.stringify({ text: 'Голос услышан' }));
  else if (request.url?.startsWith('/health'))
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
