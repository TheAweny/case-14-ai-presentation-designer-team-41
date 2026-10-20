import type { NextRequest, NextResponse } from 'next/server';
import { authSecret, type Account } from '@/lib/auth';
import { bearerToken, sessionIdentity } from '@/lib/docs-playground';
import { apiFetch } from '@/lib/api';
import { SESSION_TTL_MS, signSessionToken, verifySessionToken } from '@/lib/session-token';
import { authSource } from '@/mocks/auth-source';
import { playgroundEmpty, playgroundJson, playgroundPreflight, playgroundRefusal } from '../http';

export const dynamic = 'force-dynamic';

interface AccountRow {
  readonly id?: unknown;
  readonly email?: unknown;
  readonly name?: unknown;
  readonly role?: unknown;
  readonly disabled?: unknown;
}

/** Fields the docs header may show. The session token stays inside the signed bearer. */
function publicAccount(account: Pick<Account, 'name' | 'email' | 'role'>) {
  return { name: account.name, email: account.email, role: account.role };
}

function profileOf(row: AccountRow | null | undefined) {
  if (!row || row.disabled === true) return null;
  if (typeof row.email !== 'string' || typeof row.name !== 'string' || typeof row.id !== 'string') {
    return null;
  }
  return publicAccount({
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'user',
  });
}

async function identityFrom(request: NextRequest) {
  const token = bearerToken(request.headers.get('authorization'));
  const payload = await verifySessionToken(token ?? undefined, authSecret());
  if (!payload) return null;
  return sessionIdentity(payload);
}

async function readAccount(identity: { userId: string; sessionToken: string }) {
  const upstream = await apiFetch(
    `/auth/accounts/${encodeURIComponent(identity.userId)}`,
    { headers: { accept: 'application/json' } },
    { userId: null, sessionToken: identity.sessionToken },
  );
  if (!upstream.ok) return null;
  const body = (await upstream.json()) as { account?: AccountRow | null };
  return profileOf(body.account);
}

export function OPTIONS(request: NextRequest): NextResponse {
  return playgroundPreflight(request);
}

/** Confirms the bearer still names a live account, so a reopened tab does not show a stale name. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refused = playgroundRefusal(request);
  if (refused) return refused;
  const identity = await identityFrom(request);
  if (!identity) {
    return playgroundJson(request, 401, { message: 'Войдите через кнопку «Аккаунт».' });
  }
  try {
    const account = await readAccount(identity);
    if (!account) {
      return playgroundJson(request, 401, { message: 'Войдите через кнопку «Аккаунт».' });
    }
    return playgroundJson(request, 200, { account });
  } catch {
    return playgroundJson(request, 503, { message: 'Сервер приложения не ответил.' });
  }
}

/** Mail and password in, a signed bearer out. The service token never leaves this server. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refused = playgroundRefusal(request);
  if (refused) return refused;
  let email: unknown;
  let password: unknown;
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = body.email;
    password = body.password;
  } catch {
    return playgroundJson(request, 400, { message: 'Нужны почта и пароль.' });
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    return playgroundJson(request, 400, { message: 'Нужны почта и пароль.' });
  }
  if (email.length > 320 || password.length > 1024 || email.length === 0 || password.length === 0) {
    return playgroundJson(request, 400, { message: 'Нужны почта и пароль.' });
  }
  try {
    const account = await authSource.verifyPassword(email, password);
    if (!account?.sessionToken) {
      return playgroundJson(request, 401, { message: 'Неверная почта или пароль.' });
    }
    const token = await signSessionToken(
      `${account.userId}:session:${account.sessionToken}`,
      Date.now() + SESSION_TTL_MS,
      authSecret(),
    );
    return playgroundJson(request, 200, { token, account: publicAccount(account) });
  } catch {
    return playgroundJson(request, 503, { message: 'Сервер приложения не ответил.' });
  }
}

/** Revokes the server session and tells the page to forget the bearer. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const refused = playgroundRefusal(request);
  if (refused) return refused;
  const identity = await identityFrom(request);
  if (!identity) return playgroundEmpty(request, 204);
  try {
    const upstream = await apiFetch(
      '/auth/logout',
      { method: 'POST' },
      { userId: null, sessionToken: identity.sessionToken },
    );
    if (!upstream.ok) {
      return playgroundJson(request, 503, { message: 'Не удалось завершить сессию.' });
    }
    return playgroundEmpty(request, 204);
  } catch {
    return playgroundJson(request, 503, { message: 'Сервер приложения не ответил.' });
  }
}
