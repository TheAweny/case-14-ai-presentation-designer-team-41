'use client';

import { useEffect, useState } from 'react';

const SOURCE = 'lct-docs-connect';

export function ConnectBridge({
  token,
  account,
  returnTo,
}: {
  token: string;
  account: { name: string; email: string; role: 'admin' | 'user' };
  returnTo: string | null;
}) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const message = { source: SOURCE, token, account };
    const origin = returnTo ? new URL(returnTo).origin : null;
    if (window.opener && !window.opener.closed && origin) {
      window.opener.postMessage(message, origin);
      window.close();
      const timer = window.setTimeout(() => setStuck(true), 500);
      return () => window.clearTimeout(timer);
    }
    if (returnTo) {
      const url = new URL(returnTo);
      url.hash = `lct-account=${encodeURIComponent(JSON.stringify({ token, account }))}`;
      window.location.replace(url.toString());
      return;
    }
    setStuck(true);
    return undefined;
  }, [account, returnTo, token]);

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 px-6 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-6 text-center shadow-xl">
        <p className="text-xs tracking-wide text-zinc-500">Приложение</p>
        <h1 className="mt-2 text-lg font-medium">{account.name}</h1>
        <p className="mt-1 truncate text-sm text-zinc-400">{account.email}</p>
        <p className="mt-4 text-sm text-zinc-300">
          {stuck
            ? 'Сессия готова. Вернитесь на вкладку документации.'
            : 'Передаю сессию в документацию…'}
        </p>
      </div>
    </main>
  );
}
