import { probeService, type BackendServices } from './service-health';
import { verifySessionToken } from './session-token';

type BackendFetch = (path: string, init: RequestInit, userId: string) => Promise<Response>;
type SessionState = 'valid' | 'revoked' | 'unavailable';
const unauthorized = () =>
  Response.json(
    { message: 'Sign in first.' },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );

/** Health diagnostics distinguish a confirmed rejection from an unavailable auth dependency. */
export async function serviceStatusResponse(
  token: string | undefined,
  secret: string,
  fetchBackend: BackendFetch,
): Promise<Response> {
  const identity = await verifySessionToken(token, secret);
  const match = identity ? /^(.+):session:([\w-]{43})$/.exec(identity) : null;
  const userId = match?.[1];
  if (!userId) return unauthorized();
  const fetchHealth = (path: string, init: RequestInit) => fetchBackend(path, init, userId);
  const validateSession = async (): Promise<SessionState> => {
    try {
      const response = await fetchHealth(`/auth/accounts/${encodeURIComponent(userId)}`, {
        signal: AbortSignal.timeout(2000),
        cache: 'no-store',
      });
      if (response.status === 401) return 'revoked';
      if (!response.ok) return 'unavailable';
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('account' in payload)) return 'unavailable';
      if (payload.account === null) return 'revoked';
      return typeof payload.account === 'object' &&
        payload.account !== null &&
        'id' in payload.account &&
        payload.account.id === userId
        ? 'valid'
        : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };
  // Public API liveness remains observable even when the session database is down.
  const [api, session] = await Promise.all([
    probeService(fetchHealth, '/health', 'api'),
    validateSession(),
  ]);
  if (session === 'revoked') return unauthorized();
  let services: BackendServices;
  if (api === 'down') services = { api, engine: 'unknown', database: 'unknown' };
  else if (session === 'unavailable')
    services = { api: 'degraded', engine: 'unknown', database: 'unknown' };
  else {
    let revoked = false;
    const protectedFetch = async (path: string, init: RequestInit) => {
      const response = await fetchHealth(path, init);
      if (response.status === 401) revoked = true;
      return response;
    };
    const [engine, database] = await Promise.all([
      probeService(protectedFetch, '/health/engine', 'engine'),
      probeService(protectedFetch, '/health/database', 'postgresql'),
    ]);
    if (revoked) return unauthorized();
    services = { api, engine, database };
  }
  return Response.json(
    { services, checkedAt: Date.now() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
