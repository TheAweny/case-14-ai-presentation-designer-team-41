'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react';
import { appUrl } from '@/lib/site';
import {
  clearDocsAccount,
  getDocsAccount,
  saveDocsAccount,
  subscribeDocsAccount,
  type DocsAccountProfile,
} from '@/lib/account-store';

const HANDOFF = 'lct-docs-connect';

/**
 * Sits where the theme switch used to be. The click opens the application and takes the
 * session that is already there. This site never asks for the password itself.
 */
export function DocsAccountSlot({ className }: { className?: string; mode?: string }) {
  return (
    <div className={className} data-docs-account="">
      <DocsAccount />
    </div>
  );
}

function DocsAccount() {
  const account = useSyncExternalStore(subscribeDocsAccount, getDocsAccount, () => null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    acceptHash();
    function onMessage(event: MessageEvent) {
      if (event.origin !== originOf(appUrl())) return;
      const session = sessionOf(event.data);
      if (!session) return;
      saveDocsAccount(session);
      setError(null);
      setOpen(false);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const current = getDocsAccount();
    if (!current) return;
    const controller = new AbortController();
    void fetch(`${appUrl()}/api/docs-playground/session`, {
      headers: { accept: 'application/json', authorization: `Bearer ${current.token}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          clearDocsAccount();
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as { account?: DocsAccountProfile };
        if (body.account?.email) saveDocsAccount({ token: current.token, account: body.account });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  function connect() {
    const back = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    const url = `${appUrl()}/docs-playground/connect?return=${encodeURIComponent(back)}`;
    const popup = window.open(url, HANDOFF, 'popup,width=440,height=640');
    if (!popup) window.location.assign(url);
  }

  async function signOut() {
    const current = getDocsAccount();
    setBusy(true);
    setError(null);
    try {
      if (current) {
        const response = await fetch(`${appUrl()}/api/docs-playground/session`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${current.token}` },
        });
        if (!response.ok && response.status !== 204) {
          setError('Не удалось завершить сессию.');
          return;
        }
      }
      clearDocsAccount();
      setOpen(false);
    } catch {
      setError('Сервер приложения не ответил.');
    } finally {
      setBusy(false);
    }
  }

  const place = usePlace(button, open);
  const label = account ? account.account.name : 'Войти';
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 pe-3 ps-1 text-sm text-fd-foreground shadow-sm transition hover:border-fd-primary/40 hover:bg-fd-accent"
        aria-expanded={account ? open : undefined}
        aria-haspopup={account ? 'dialog' : undefined}
        onClick={() => {
          if (account) setOpen((value) => !value);
          else connect();
        }}
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-full bg-fd-primary text-[11px] font-semibold text-fd-primary-foreground"
        >
          {account ? initials(account.account.name) : <EnterMark />}
        </span>
        <span className="max-w-28 truncate font-medium">{label}</span>
      </button>
      {open && account ? (
        <div
          ref={panel}
          role="dialog"
          aria-labelledby={titleId}
          className="fixed z-50 w-72 rounded-2xl border border-fd-border bg-fd-popover p-3 text-fd-popover-foreground shadow-xl"
          style={place}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-full bg-fd-primary text-sm font-semibold text-fd-primary-foreground"
            >
              {initials(account.account.name)}
            </span>
            <span className="min-w-0">
              <span id={titleId} className="block truncate text-sm font-medium">
                {account.account.name}
              </span>
              <span className="block truncate text-xs text-fd-muted-foreground">
                {account.account.email}
              </span>
            </span>
          </div>
          <p className="mt-3 text-xs text-fd-muted-foreground">
            {account.account.role === 'admin' ? 'Администратор' : 'Пользователь'} приложения. Запросы
            консоли идут от этого аккаунта.
          </p>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-fd-primary">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-fd-border px-3 py-1.5 text-sm hover:bg-fd-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void signOut()}
          >
            {busy ? 'Выхожу…' : 'Выйти'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function usePlace(anchor: RefObject<HTMLButtonElement | null>, active: boolean): CSSProperties {
  const [place, setPlace] = useState<CSSProperties>({ top: 8, left: 8 });
  useEffect(() => {
    if (!active) return;
    function measure() {
      const rect = anchor.current?.getBoundingClientRect();
      const width = 288;
      if (!rect) return;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const up = rect.bottom > window.innerHeight * 0.62;
      setPlace(
        up
          ? { left, bottom: Math.max(8, window.innerHeight - rect.top + 8) }
          : { left, top: rect.bottom + 8 },
      );
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [active, anchor]);
  return place;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return (letters || name.slice(0, 1) || '?').toUpperCase();
}

function originOf(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function sessionOf(data: unknown): { token: string; account: DocsAccountProfile } | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as { source?: unknown; token?: unknown; account?: Partial<DocsAccountProfile> };
  if (row.source !== HANDOFF || typeof row.token !== 'string' || !row.token) return null;
  const account = row.account;
  if (!account || typeof account.email !== 'string' || typeof account.name !== 'string') return null;
  return {
    token: row.token,
    account: {
      name: account.name,
      email: account.email,
      role: account.role === 'admin' ? 'admin' : 'user',
    },
  };
}

function acceptHash(): void {
  const marker = '#lct-account=';
  if (!window.location.hash.startsWith(marker)) return;
  const encoded = window.location.hash.slice(marker.length);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  try {
    const session = sessionOf({ source: HANDOFF, ...JSON.parse(decodeURIComponent(encoded)) });
    if (session) saveDocsAccount(session);
  } catch {
    // A broken hash is ignored. The button can ask the application again.
  }
}

function EnterMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M3.5 13.2c.6-2.2 2.2-3.3 4.5-3.3s3.9 1.1 4.5 3.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
