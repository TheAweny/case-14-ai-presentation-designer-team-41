import { currentAccount } from '@/app/auth-session';
import { apiFetch } from '@/lib/api';
import { checkBackendServices } from '@/lib/service-health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const account = await currentAccount();
  if (!account) return Response.json({ message: 'Sign in first.' }, { status: 401 });

  const services = await checkBackendServices((path, init) =>
    apiFetch(path, init, { userId: account.userId }),
  );
  return Response.json(
    { services, checkedAt: Date.now() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
