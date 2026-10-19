import http from 'node:http';
if (process.env.RECOVERY_ACCESS !== '1') throw new Error('Requires the disposable access fixture.');
let mode = 'healthy';
const modes = new Set(['healthy', 'auth-error', 'auth-invalid-json', 'api-down']);
const upstream = 'http://127.0.0.1:13019';
http
  .createServer(async (req, res) => {
    if (req.url === '/__fixture/health' && req.method === 'POST') {
      let body = '';
      for await (const part of req) body += part;
      if (req.headers['x-recovery-control'] !== 'health-fixture-only' || !modes.has(body)) {
        res.writeHead(400);
        res.end();
        return;
      }
      mode = body;
      res.writeHead(204);
      res.end();
      return;
    }
    if (mode === 'api-down' || (mode === 'auth-error' && req.url?.startsWith('/auth/accounts/'))) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Injected service outage' }));
      return;
    }
    if (mode === 'auth-invalid-json' && req.url?.startsWith('/auth/accounts/')) {
      res.writeHead(200);
      res.end('{');
      return;
    }
    try {
      const body = [];
      for await (const part of req) body.push(part);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.connection;
      delete headers['content-length'];
      const response = await fetch(`${upstream}${req.url}`, {
        method: req.method,
        headers,
        body: body.length ? Buffer.concat(body) : undefined,
        signal: AbortSignal.timeout(5000),
      });
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503);
      res.end();
    }
  })
  .listen(13319, '127.0.0.1', () => console.log('Disposable health proxy :13319 → :13019'));
