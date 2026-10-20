import type { NextRequest, NextResponse } from 'next/server';
import { authSecret } from '@/lib/auth';
import { apiFetch } from '@/lib/api';
import { bearerToken, playgroundApiPath, sessionIdentity } from '@/lib/docs-playground';
import { verifySessionToken } from '@/lib/session-token';
import {
  playgroundCors,
  playgroundJson,
  playgroundPreflight,
  playgroundRefusal,
} from '../http';

export const dynamic = 'force-dynamic';

const PASSED_HEADERS = ['content-type', 'content-length', 'content-disposition'];

/**
 * Swagger on the docs site calls this instead of the API. The bearer is the signed session
 * from `POST /api/docs-playground/session`. This route adds the service token and the account
 * headers; the browser never sees them. The API still decides what that account may do.
 */
async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const refused = playgroundRefusal(request);
  if (refused) return refused;

  const payload = await verifySessionToken(
    bearerToken(request.headers.get('authorization')) ?? undefined,
    authSecret(),
  );
  const identity = payload ? sessionIdentity(payload) : null;
  if (!identity) {
    return playgroundJson(request, 401, { message: 'Войдите через кнопку «Аккаунт».' });
  }

  const path = playgroundApiPath((await context.params).path);
  if (!path) return playgroundJson(request, 404, { message: 'Маршрут не найден.' });

  const headers = new Headers();
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    const upstream = await apiFetch(
      `${path}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
        redirect: 'manual',
        signal: request.signal,
      } as RequestInit,
      { userId: identity.userId, sessionToken: identity.sessionToken },
    );
    const answer = playgroundCors(request);
    for (const name of PASSED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) answer.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: answer });
  } catch {
    return playgroundJson(request, 503, { message: 'Сервер приложения не ответил.' });
  }
}

export function OPTIONS(request: NextRequest): NextResponse {
  return playgroundPreflight(request);
}

export {
  forward as GET,
  forward as POST,
  forward as PUT,
  forward as PATCH,
  forward as DELETE,
};
