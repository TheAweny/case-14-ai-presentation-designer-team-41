import { NextResponse, type NextRequest } from 'next/server';
import { apiDocsEnabled } from '@/lib/api-docs-access';
import { playgroundOriginAllowed } from '@/lib/docs-playground';

const ALLOW_HEADERS = 'authorization, content-type, accept';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/** CORS for one docs origin. A refused origin gets no allow header, so the browser hides the body. */
export function playgroundCors(request: NextRequest): Headers {
  const headers = new Headers();
  const origin = request.headers.get('origin');
  if (origin && playgroundOriginAllowed(origin, request.url)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'origin');
    headers.set('access-control-allow-headers', ALLOW_HEADERS);
    headers.set('access-control-allow-methods', ALLOW_METHODS);
    headers.set('access-control-max-age', '600');
  }
  headers.set('cache-control', 'no-store');
  return headers;
}

export function playgroundJson(
  request: NextRequest,
  status: number,
  body: unknown,
): NextResponse {
  const headers = playgroundCors(request);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new NextResponse(JSON.stringify(body), { status, headers });
}

export function playgroundEmpty(request: NextRequest, status: number): NextResponse {
  return new NextResponse(null, { status, headers: playgroundCors(request) });
}

/**
 * Preflight is allowed whenever the origin is, including while the console is off: the real
 * request then returns 404 and the page can show that. A foreign origin is refused here.
 */
export function playgroundPreflight(request: NextRequest): NextResponse {
  if (!playgroundOriginAllowed(request.headers.get('origin'), request.url)) {
    return new NextResponse(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  return playgroundEmpty(request, 204);
}

/** 404 while the console is off, 403 for a foreign browser, otherwise null. */
export function playgroundRefusal(request: NextRequest): NextResponse | null {
  if (!playgroundOriginAllowed(request.headers.get('origin'), request.url)) {
    return playgroundJson(request, 403, {
      message: 'Этот сайт не может пользоваться консолью API.',
    });
  }
  if (!apiDocsEnabled()) {
    return playgroundJson(request, 404, {
      message: 'Консоль API на этом сервере выключена.',
    });
  }
  return null;
}
