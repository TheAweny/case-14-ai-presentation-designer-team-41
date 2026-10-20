import { randomBytes } from 'node:crypto';
import type { EnvFile } from './env-file.js';

/**
 * Secrets every installation makes for itself, once:
 *
 * - `AUTH_SECRET` signs the session cookies of the interface;
 * - `API_SERVICE_TOKEN` is how the API knows a request comes from this web server;
 * - `MODEL_KEYS_SECRET` encrypts the model API keys the API stores.
 *
 * An existing value is kept: a new `MODEL_KEYS_SECRET` would make every stored key unreadable,
 * a new `AUTH_SECRET` would sign everyone out. A value anyone could know — empty, or copied from
 * the documentation — is not a secret and is replaced.
 */

export const INSTALLATION_SECRETS = [
  'AUTH_SECRET',
  'API_SERVICE_TOKEN',
  'MODEL_KEYS_SECRET',
  'SEARXNG_SECRET',
] as const;
export type InstallationSecret = (typeof INSTALLATION_SECRETS)[number];

/** Shorter than this, a value is a password rather than a random secret. */
export const SECRET_MIN_LENGTH = 32;

/** Values published in `.env.example` and the docs at some point. */
const KNOWN_VALUES = new Set(['lct26-local-auth-secret-change-me']);

export function isUsableSecret(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  return trimmed.length >= SECRET_MIN_LENGTH && !KNOWN_VALUES.has(trimmed);
}

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Fills in every secret that is missing or known; returns the names it created. */
export function ensureInstallationSecrets(
  env: EnvFile,
  generate: () => string = newSecret,
): InstallationSecret[] {
  const created: InstallationSecret[] = [];
  for (const name of INSTALLATION_SECRETS) {
    if (isUsableSecret(env.get(name))) continue;
    env.set(name, generate());
    created.push(name);
  }
  return created;
}

/** PostgreSQL applies its password only on first initialization; never rotate it on reconfigure. */
export function ensureDatabaseSettings(env: EnvFile, fresh: boolean): boolean {
  let generated = false;
  if (fresh || !env.get('POSTGRES_PASSWORD')) {
    if (!fresh)
      throw new Error('Пароль БД отсутствует. Восстановите POSTGRES_PASSWORD из резервной копии.');
    env.set('POSTGRES_PASSWORD', newSecret());
    generated = true;
  }
  const user = encodeURIComponent(env.get('POSTGRES_USER') || 'lct26');
  const password = encodeURIComponent(env.get('POSTGRES_PASSWORD') ?? '');
  const database = encodeURIComponent(env.get('POSTGRES_DB') || 'lct26');
  if (fresh || !env.get('DATABASE_URL'))
    env.set(
      'DATABASE_URL',
      `postgresql://${user}:${password}@localhost:${env.get('POSTGRES_PORT') || '5433'}/${database}`,
    );
  return generated;
}
