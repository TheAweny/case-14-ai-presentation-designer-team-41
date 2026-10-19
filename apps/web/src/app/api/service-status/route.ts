// Register the request-scoped API identity/session resolvers; do not depend on currentAccount.
import '@/app/auth-session';
import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api';
import { SESSION_COOKIE, authSecret } from '@/lib/auth';
import { serviceStatusResponse } from '@/lib/service-status-response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return serviceStatusResponse(
    (await cookies()).get(SESSION_COOKIE)?.value,
    authSecret(),
    (path, init, userId) => apiFetch(path, init, { userId }),
  );
}
