import { apiFetch } from '../lib/api';
import type { Account, AuthSource } from '../lib/auth';

interface ApiAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

function account(row: ApiAccount): Account {
  return { userId: row.id, email: row.email, name: row.name };
}

/**
 * The account in an API answer, or null. The API answers `{ account }`; an empty body or a bare
 * row, which older builds sent, are read too, so a wrong password is a wrong password and never
 * a crash on JSON.parse.
 */
async function accountOf(response: Response): Promise<Account | null> {
  if (!response.ok) return null;
  const text = await response.text();
  if (text.trim() === '') return null;
  const payload = JSON.parse(text) as { account?: ApiAccount | null } | ApiAccount | null;
  if (payload === null) return null;
  const row = 'account' in payload ? payload.account : (payload as ApiAccount);
  return row && typeof row.id === 'string' ? account(row) : null;
}

export function createApiAuth(): AuthSource {
  return {
    async hasAccounts() {
      const response = await apiFetch('/auth/accounts');
      if (!response.ok) return false;
      const payload = (await response.json()) as { hasAccounts?: unknown };
      return payload.hasAccounts === true;
    },
    async verifyPassword(email, password) {
      const response = await apiFetch('/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return accountOf(response);
    },
    async getAccount(userId) {
      const response = await apiFetch(`/auth/accounts/${encodeURIComponent(userId)}`);
      return accountOf(response);
    },
  };
}
