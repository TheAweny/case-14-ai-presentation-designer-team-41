/** Session of the API console. It lives in this tab and is never written to the article. */

const KEY = 'lct.docs.account';

export interface DocsAccountProfile {
  readonly name: string;
  readonly email: string;
  readonly role: 'admin' | 'user';
}

export interface DocsAccountSession {
  readonly token: string;
  readonly account: DocsAccountProfile;
}

let snapshot: DocsAccountSession | null | undefined;
const listeners = new Set<() => void>();

function stored(value: unknown): DocsAccountSession | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { token?: unknown; account?: Partial<DocsAccountProfile> };
  const account = row.account;
  if (typeof row.token !== 'string' || !row.token) return null;
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

function readStorage(): DocsAccountSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? stored(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function getDocsAccount(): DocsAccountSession | null {
  if (typeof window === 'undefined') return null;
  if (snapshot !== undefined) return snapshot;
  snapshot = readStorage();
  return snapshot;
}

export function subscribeDocsAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: DocsAccountSession | null): void {
  snapshot = next;
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
  } catch {
    // A private window can refuse storage. The name still shows until reload.
  }
  for (const listener of listeners) listener();
}

export function saveDocsAccount(session: DocsAccountSession): void {
  publish(session);
}

export function clearDocsAccount(): void {
  publish(null);
}
