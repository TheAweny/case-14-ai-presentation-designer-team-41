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
  /** The picture: null — the mark the id gives, `preset:N` — a mark picked, or an image. */
  readonly avatar?: string | null;
}

/** How many abstract marks there are to pick from. */
export const AVATAR_PRESETS = 10;
/**
 * An uploaded picture as the browser sends it: a square of 256 px, a few tens of kilobytes. The
 * cap leaves room for a busy photo and keeps an account row small.
 */
export const MAX_AVATAR_LENGTH = 200_000;

const IMAGE_SIGNATURES: Readonly<Record<string, (bytes: Buffer) => boolean>> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) =>
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/**
 * Why a value cannot be an avatar, or null when it can. An image must be what it says it is: a
 * PNG, JPEG or WebP data URL whose bytes start like one, so nothing else is shown as a picture.
 */
export function avatarProblem(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return 'Avatar must be a string or null.';
  const preset = /^preset:(\d+)$/.exec(value);
  if (preset) {
    return Number(preset[1]) < AVATAR_PRESETS ? null : 'No such avatar.';
  }
  if (value.length > MAX_AVATAR_LENGTH) return 'The picture is too large.';
  const image = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  const check = image ? IMAGE_SIGNATURES[image[1] ?? ''] : undefined;
  if (!image || !check || !check(Buffer.from(image[2] ?? '', 'base64'))) {
    return 'The picture must be a PNG, JPEG or WebP image.';
  }
  return null;
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
