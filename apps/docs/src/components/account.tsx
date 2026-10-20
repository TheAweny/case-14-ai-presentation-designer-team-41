'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
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

/**
 * Sits where the theme switch used to be: the docs stay dark, and this button is the account
 * the API console calls as.
 */
export function DocsAccountSlot({ className }: { className?: string; mode?: string }) {
  return (
    <div className={className}>
      <DocsAccount />
    </div>
  );
}

function DocsAccount() {
  const account = useSyncExternalStore(subscribeDocsAccount, getDocsAccount, () => null);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

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

  const label = account ? account.account.name : 'Войти';
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        className="max-w-36 truncate rounded-md px-2 py-1 text-sm text-fd-foreground hover:bg-fd-accent"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <AccountPanel
          panel={panel}
          anchor={button.current}
          titleId={titleId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AccountPanel({
  panel,
  anchor,
  titleId,
  onClose,
}: {
  panel: RefObject<HTMLDivElement | null>;
  anchor: HTMLButtonElement | null;
  titleId: string;
  onClose: () => void;
}) {
  const place = usePlace(anchor);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-50 w-72 rounded-xl border border-fd-border bg-fd-popover p-3 text-fd-popover-foreground shadow-lg"
      style={place}
    >
      <AccountForm titleId={titleId} onClose={onClose} />
    </div>
  );
}

function usePlace(anchor: HTMLButtonElement | null): CSSProperties {
  const [place, setPlace] = useState<CSSProperties>({ top: 0, left: 8 });
  useEffect(() => {
    function measure() {
      const rect = anchor?.getBoundingClientRect();
      const width = 288;
      if (!rect) return;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const below = rect.bottom + 8;
      const up = rect.bottom > window.innerHeight * 0.62;
      setPlace(
        up
          ? { left, bottom: Math.max(8, window.innerHeight - rect.top + 8) }
          : { left, top: below },
      );
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchor]);
  return place;
}

function AccountForm({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  const session = useSyncExternalStore(subscribeDocsAccount, getDocsAccount, () => null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${appUrl()}/api/docs-playground/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => null)) as {
        token?: string;
        account?: DocsAccountProfile;
        message?: string;
      } | null;
      if (!response.ok || !body?.token || !body.account) {
        setError(messageOf(response.status, body?.message));
        return;
      }
      saveDocsAccount({ token: body.token, account: body.account });
      setPassword('');
      onClose();
    } catch {
      setError('Сервер приложения не ответил.');
    } finally {
      setBusy(false);
    }
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
      onClose();
    } catch {
      setError('Сервер приложения не ответил.');
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    const { account } = session;
    return (
      <div>
        <p id={titleId} className="text-sm font-medium">
          {account.name}
        </p>
        <p className="mt-1 truncate text-xs text-fd-muted-foreground">{account.email}</p>
        <p className="mt-1 text-xs text-fd-muted-foreground">
          {account.role === 'admin' ? 'Администратор' : 'Пользователь'}
        </p>
        <p className="mt-3 text-xs text-fd-muted-foreground">
          Запросы в консоли API идут от этого аккаунта.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-fd-primary">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-3 w-full rounded-md border border-fd-border px-3 py-1.5 text-sm hover:bg-fd-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void signOut()}
        >
          Выйти
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void signIn(event)}>
      <p id={titleId} className="text-sm font-medium">
        Аккаунт
      </p>
      <p className="mt-1 text-xs text-fd-muted-foreground">
        Тот же вход, что в приложении. Сессия остаётся в этой вкладке.
      </p>
      <label className="mt-3 block text-xs" htmlFor={`${titleId}-email`}>
        Почта
        <input
          id={`${titleId}-email`}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-md border border-fd-border bg-fd-background px-2 py-1.5 text-sm"
        />
      </label>
      <label className="mt-2 block text-xs" htmlFor={`${titleId}-password`}>
        Пароль
        <input
          id={`${titleId}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-md border border-fd-border bg-fd-background px-2 py-1.5 text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-fd-primary">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="mt-3 w-full rounded-md bg-fd-primary px-3 py-1.5 text-sm text-fd-primary-foreground disabled:opacity-60"
        disabled={busy}
      >
        {busy ? 'Вхожу…' : 'Войти'}
      </button>
    </form>
  );
}

function messageOf(status: number, message: string | undefined): string {
  if (status === 401) return 'Неверная почта или пароль.';
  if (status === 404) {
    return 'Консоль API на этом сервере выключена. Её включает API_DOCS_ENABLED.';
  }
  if (status === 403) {
    return 'Сервер не разрешил этот адрес документации. Задайте DOCS_PUBLIC_URL.';
  }
  return message || 'Сервер приложения не ответил.';
}
