import { NextResponse, type NextRequest } from 'next/server';
import { currentAccount } from '@/app/auth-session';
import { apiFetch } from '@/lib/api';
import { proxiedApiPath } from '@/lib/api-proxy';
import { trustedOrigin } from '@/lib/request-origin';

/**
 * The browser's way to the API. Uploads, generation, its progress, previews and downloads come
 * here with the session cookie; this route checks who is signed in and forwards the request with
 * the service token, which the browser never sees. Only the routes the interface uses are
 * forwarded (`lib/api-proxy.ts`); accounts, model settings and the rest stay reachable from
 * server code alone.
 *
 * Bodies are streamed both ways, so a 30 MB template or a PDF does not sit in memory here.
 */

export const dynamic = 'force-dynamic';

/** Answer headers worth passing on; hop-by-hop and server details stay behind. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control'];

async function forward(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ message: 'Sign in first.' }, { status: 401 });

  // Cookies are SameSite=Lax, and a changing request from another site is refused on top of it.
  const origin = request.headers.get('origin');
  if (
    request.method !== 'GET' &&
    (origin === null || !trustedOrigin(origin, request.url, process.env.APP_ORIGIN))
  ) {
    return NextResponse.json({ message: 'Cross-site request refused.' }, { status: 403 });
  }

  const path = proxiedApiPath((await params).path, request.method);
  if (path === null) return NextResponse.json({ message: 'Not found.' }, { status: 404 });

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await apiFetch(
    `${path}${request.nextUrl.search}`,
    {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Node streams a request body only when told it is half-duplex.
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      signal: request.signal,
    } as RequestInit,
    { userId: account.userId },
  );

  const answer = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) answer.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: answer });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
