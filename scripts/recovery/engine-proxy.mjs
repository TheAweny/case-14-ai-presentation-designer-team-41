import http from 'node:http';
let failExport = process.env.RECOVERY_FAIL_EXPORT !== '0';
http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    if (req.url === '/v1/composition-decks' && failExport) {
      failExport = false;
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Injected one export failure; no model failure.' }));
      console.log('Injected the single export failure');
      return;
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:18019${req.url}`, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        ...(req.method === 'GET' ? {} : { body: raw }),
      });
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end('engine proxy unavailable');
    }
  })
  .listen(18020, '0.0.0.0', () =>
    console.log(`Engine proxy 18020; export failure injection: ${failExport}`),
  );
