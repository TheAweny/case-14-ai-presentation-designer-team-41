/**
 * What an account may look like. There is no self sign-up: accounts are made by an administrator
 * in the web interface, and the first administrator comes from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
 * Pure functions, checked by tests.
 */

export const ACCOUNT_ROLES = ['admin', 'user'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_NAME_LENGTH = 120;

/** An account as the API hands it out. Never the password hash. */
export interface Account {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: AccountRole;
  readonly disabled: boolean;
  readonly createdAt: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/** Why an email cannot be used, or null when it can. */
export function emailProblem(email: unknown): string | null {
  if (typeof email !== 'string') return 'Email is required.';
  const value = normalizeEmail(email);
  if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Email must look like name@example.com.';
  }
  return null;
}

/** Why a password cannot be used, or null when it can. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Why a display name cannot be used, or null when it can. */
export function nameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim() === '') return 'Name is required.';
  if (name.trim().length > MAX_NAME_LENGTH) {
    return `Name must be at most ${MAX_NAME_LENGTH} characters.`;
  }
  return null;
}

/** The administrator `.env` asks for, or null when it names none or names it badly. */
export function configuredAdmin(
  env: Readonly<Record<string, string | undefined>>,
): { email: string; password: string; name: string } | null {
  const email = normalizeEmail(env.ADMIN_EMAIL ?? '');
  const password = env.ADMIN_PASSWORD ?? '';
  if (email === '' || emailProblem(email) !== null || passwordProblem(password) !== null) {
    return null;
  }
  const name = env.ADMIN_NAME?.trim() || email.slice(0, email.indexOf('@'));
  return { email, password, name };
}
