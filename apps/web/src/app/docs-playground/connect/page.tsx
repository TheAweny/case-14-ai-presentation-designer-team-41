import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { apiDocsEnabled } from '@/lib/api-docs-access';
import { SESSION_COOKIE, authSecret, loginHref } from '@/lib/auth';
import { docsReturnUrl, sessionIdentity } from '@/lib/docs-playground';
import { SESSION_TTL_MS, signSessionToken, verifySessionToken } from '@/lib/session-token';
import { currentAccount } from '../../auth-session';
import { ConnectBridge } from './connect-bridge';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Документация' };

/**
 * The docs site cannot read the httpOnly session cookie. This page lives on the app, so the
 * cookie is present: it hands the same session to the docs tab and does not ask for a password.
 */
export default async function DocsConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string | string[] }>;
}) {
  const raw = (await searchParams).return;
  const returnTo = docsReturnUrl(typeof raw === 'string' ? raw : null);
  const back = returnTo
    ? `/docs-playground/connect?return=${encodeURIComponent(returnTo)}`
    : '/docs-playground/connect';

  if (!apiDocsEnabled()) {
    return (
      <ConnectShell>
        <h1 className="text-lg font-medium">Консоль выключена</h1>
        <p className="mt-2 text-sm text-zinc-400">
          На этом сервере документация API не включена. Её включает API_DOCS_ENABLED.
        </p>
      </ConnectShell>
    );
  }

  const account = await currentAccount().catch(() => null);
  if (!account) redirect(loginHref(back));

  const payload = await verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
    authSecret(),
  );
  const identity = payload ? sessionIdentity(payload) : null;
  if (!identity || identity.userId !== account.userId) redirect(loginHref(back));

  const token = await signSessionToken(
    `${identity.userId}:session:${identity.sessionToken}`,
    Date.now() + SESSION_TTL_MS,
    authSecret(),
  );

  return (
    <ConnectBridge
      token={token}
      account={{ name: account.name, email: account.email, role: account.role }}
      returnTo={returnTo}
    />
  );
}

function ConnectShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-center shadow-xl">
        {children}
      </div>
    </main>
  );
}
