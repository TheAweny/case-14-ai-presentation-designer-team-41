import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvFile } from './env-file.js';
import { ensureDatabaseSettings } from './secrets.js';
import { domainProblem, localUrls, portProblem, publicUrl, setFeatures } from './settings.js';
import { nodeVersionOk } from './stack.js';
import { parseArgs } from './args.js';

const directories: string[] = [];
function fixture(text = '') {
  const directory = mkdtempSync(join(tmpdir(), 'lct-settings-'));
  directories.push(directory);
  const path = join(directory, '.env');
  writeFileSync(path, text);
  return { env: EnvFile.open(path), path };
}
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe('installation settings', () => {
  it('uses selected host ports and an HTTPS origin consistently', () => {
    const { env } = fixture(
      'WEB_PORT=3080\nAPI_HOST_PORT=3081\nAPP_ORIGIN=https://slides.example.com\n',
    );
    expect(localUrls(env)).toEqual({ api: 'http://127.0.0.1:3081', web: 'http://127.0.0.1:3080' });
    expect(publicUrl(env)).toBe('https://slides.example.com');
  });
  it('disables search without removing the HTTPS profile', () => {
    const { env } = fixture('COMPOSE_PROFILES=search,https\n');
    setFeatures(env, false, false);
    expect(env.get('WEB_SEARCH_URL')).toBe('');
    expect(env.get('API_DOCS_ENABLED')).toBe('false');
    expect(env.get('COMPOSE_PROFILES')).toBe('https');
    setFeatures(env, true, true);
    expect(env.get('COMPOSE_PROFILES')).toBe('https,search');
  });
  it.each(['0', '65536', '3000/tcp', '-1', '3.5'])('rejects port %s', (value) =>
    expect(portProblem(value)).toBeDefined(),
  );
  it.each([
    'https://example.com',
    'example.com/path',
    '127.0.0.1',
    'example.com:443',
    'example.com\nlocalhost',
  ])('rejects domain %s', (value) => expect(domainProblem(value)).toBeDefined());
  it('accepts a domain and enforces the full Node version requirement', () => {
    expect(domainProblem('slides.example.com')).toBeUndefined();
    expect(nodeVersionOk('v22.12.0')).toBe(false);
    expect(nodeVersionOk('v22.13.0')).toBe(true);
    expect(nodeVersionOk('v24.1.0')).toBe(true);
  });
  it('keeps equals signs in inline keys', () => {
    expect(parseArgs(['--api-key=a=b==']).flags['api-key']).toBe('a=b==');
  });
});

describe('installation credentials', () => {
  it('generates a database password once and matches the host database URL', () => {
    const { env } = fixture('POSTGRES_PASSWORD=lct26-local\nPOSTGRES_PORT=5433\n');
    expect(ensureDatabaseSettings(env, true)).toBe(true);
    const password = env.get('POSTGRES_PASSWORD');
    expect(password).toHaveLength(43);
    expect(env.get('DATABASE_URL')).toBe(`postgresql://lct26:${password}@localhost:5433/lct26`);
    expect(ensureDatabaseSettings(env, false)).toBe(false);
    expect(env.get('POSTGRES_PASSWORD')).toBe(password);
  });
  it('preserves an existing database password and external URL', () => {
    const { env } = fixture(
      'POSTGRES_PASSWORD=existing-password\nDATABASE_URL=postgresql://external/db\n',
    );
    ensureDatabaseSettings(env, false);
    expect(env.get('POSTGRES_PASSWORD')).toBe('existing-password');
    expect(env.get('DATABASE_URL')).toBe('postgresql://external/db');
  });
  it('refuses to replace a missing existing password', () => {
    const { env } = fixture();
    expect(() => ensureDatabaseSettings(env, false)).toThrow(/резервной копии/);
  });
  it('preserves literal dollars, quotes, hashes and spaces in Compose env files', () => {
    const { env, path } = fixture();
    const password = "a$token # it's private";
    env.set('ADMIN_PASSWORD', password);
    env.save();
    expect(readFileSync(path, 'utf8')).toContain('ADMIN_PASSWORD="a$$token # it\'s private"');
    expect(EnvFile.open(path).get('ADMIN_PASSWORD')).toBe(password);
    expect(() => env.set('ADMIN_PASSWORD', 'value\nX=other')).toThrow();
  });
  it('reads CRLF without including carriage returns in secrets', () => {
    const { env } = fixture('API_SERVICE_TOKEN=test-token\r\n');
    expect(env.get('API_SERVICE_TOKEN')).toBe('test-token');
  });
  it('keeps comments out of existing secrets and honors the last assignment', () => {
    const { env } = fixture(
      'MODEL_KEYS_SECRET=old-value\nMODEL_KEYS_SECRET=existing-secret # operator note\n',
    );
    expect(env.get('MODEL_KEYS_SECRET')).toBe('existing-secret');
    env.set('MODEL_KEYS_SECRET', 'retained-secret');
    expect(env.get('MODEL_KEYS_SECRET')).toBe('retained-secret');
  });
  it.each([
    'valid-password\\',
    'back\\slash',
    'quote"and\\"pair',
    "single\\'quote",
    '$1 $$PATH ${NAME}',
  ])('round trips special credentials: %s', (value) => {
    const { env, path } = fixture();
    env.set('ADMIN_PASSWORD', value);
    env.save();
    expect(EnvFile.open(path).get('ADMIN_PASSWORD')).toBe(value);
  });
  it('refuses unresolved variable references instead of rewriting encryption keys', () => {
    const { env } = fixture('MODEL_KEYS_SECRET=${KEY_FROM_SHELL}\n');
    expect(() => env.get('MODEL_KEYS_SECRET')).toThrow(/буквальное значение/);
  });
});
