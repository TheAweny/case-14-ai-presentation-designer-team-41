import type { Account, AuthSource } from '../lib/auth';

interface ApiAccount {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

function apiUrl(): string {
  return process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

function account(row: ApiAccount): Account {
  return { userId: row.id, email: row.email, name: row.name };
}

export function createApiAuth(): AuthSource {
  return {
    async hasAccounts() {
      const response = await fetch(`${apiUrl()}/auth/accounts`, { cache: 'no-store' });
      if (!response.ok) return false;
      const payload = (await response.json()) as { hasAccounts?: unknown };
      return payload.hasAccounts === true;
    },
    async verifyPassword(email, password) {
      const response = await fetch(`${apiUrl()}/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ApiAccount | null;
      return payload === null ? null : account(payload);
    },
    async getAccount(userId) {
      const response = await fetch(`${apiUrl()}/auth/accounts/${encodeURIComponent(userId)}`, {
        cache: 'no-store',
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as ApiAccount | null;
      return payload === null ? null : account(payload);
    },
  };
}
