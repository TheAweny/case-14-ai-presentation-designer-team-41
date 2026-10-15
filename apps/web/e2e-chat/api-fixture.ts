import { createServer } from 'node:http';

/** Only fixed test data. Browser chat requests are intercepted by each Playwright scenario. */
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url?.startsWith('/auth/accounts/'))
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
    response.end(JSON.stringify({ connections: [], roles: [] }));
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
