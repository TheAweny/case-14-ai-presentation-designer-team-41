import { cookies } from 'next/headers';
import { apiFetch } from '@/lib/api';
import { SESSION_COOKIE, authSecret } from '@/lib/auth';
import { checkBackendServices } from '@/lib/service-health';
import { verifySessionToken } from '@/lib/session-token';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const userId = await verifySessionToken(token, authSecret());
  if (!userId) return Response.json({ message: 'Sign in first.' }, { status: 401 });

  const services = await checkBackendServices((path, init) => apiFetch(path, init, { userId }));
  return Response.json(
    { services, checkedAt: Date.now() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
