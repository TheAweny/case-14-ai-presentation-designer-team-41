/**
 * Accounts of the web interface as AUTH_USERS stores them: `email:password:Name` entries joined
 * by `;`. The web app reads the same format (apps/web, lib/auth.ts); there is no self sign-up,
 * so whoever installs the service creates the accounts here.
 */
export interface User {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export const MIN_PASSWORD = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseUsers(value: string | undefined): User[] {
  const users: User[] = [];
  const seen = new Set<string>();
  for (const entry of (value ?? '').split(';')) {
    const [rawEmail = '', password = '', ...nameParts] = entry.split(':');
    const email = normalizeEmail(rawEmail);
    if (!email.includes('@') || password === '' || seen.has(email)) continue;
    seen.add(email);
    users.push({
      email,
      password,
      name: nameParts.join(':').trim() || email.split('@')[0] || email,
    });
  }
  return users;
}

export function formatUsers(users: readonly User[]): string {
  return users.map((u) => `${u.email}:${u.password}:${u.name}`).join(';');
}

/** Why an email cannot be used, or undefined when it can. */
export function emailProblem(email: string): string | undefined {
  const value = normalizeEmail(email);
  if (!/^[^\s@:;]+@[^\s@:;]+\.[^\s@:;]+$/.test(value)) return 'Нужна почта вида name@example.com';
  return undefined;
}

/** Why a password cannot be used, or undefined when it can. `:` and `;` would break the list. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return `Не короче ${MIN_PASSWORD} символов`;
  if (/[:;\s]/.test(password)) return 'Без двоеточий, точек с запятой и пробелов';
  return undefined;
}

/** Why a display name cannot be used, or undefined when it can. */
export function nameProblem(name: string): string | undefined {
  if (name.trim() === '') return 'Имя не может быть пустым';
  if (name.includes(';')) return 'Без точки с запятой';
  return undefined;
}

/** The list with the user added, or replacing the entry with the same email. */
export function upsertUser(users: readonly User[], user: User): User[] {
  const email = normalizeEmail(user.email);
  const next = users.filter((u) => u.email !== email);
  next.push({ ...user, email, name: user.name.trim() });
  return next;
}
