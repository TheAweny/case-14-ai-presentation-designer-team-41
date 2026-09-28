/**
 * Accounts as AUTH_USERS lists them: `email:password:Name` entries joined by `;`, the format
 * `lct onboard` and `lct user` write and apps/web documents. There is no self sign-up, so this
 * list is how an installation gets its accounts.
 */
export interface SeedUser {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export function parseAuthUsers(value: string | undefined): SeedUser[] {
  const users: SeedUser[] = [];
  const seen = new Set<string>();
  for (const entry of (value ?? '').split(';')) {
    const [rawEmail = '', password = '', ...nameParts] = entry.split(':');
    const email = rawEmail.trim().toLowerCase();
    if (!email.includes('@') || password === '' || seen.has(email)) continue;
    seen.add(email);
    users.push({
      email,
      password,
      name: nameParts.join(':').trim() || email.slice(0, email.indexOf('@')),
    });
  }
  return users;
}
