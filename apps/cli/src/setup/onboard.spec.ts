import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvFile } from './env-file.js';

const state = vi.hoisted(() => ({ root: '', running: [] as string[], volume: false }));
vi.mock('./stack.js', () => ({
  repoRoot: () => state.root,
  composeCommand: () => ['docker', 'compose'],
  buildxOk: () => true,
  BUILDX_HINT: 'buildx required',
  runningServices: () => state.running,
  databaseVolumeExists: () => state.volume,
  run: vi.fn(async () => 0),
  compose: vi.fn(async () => 0),
  portFree: vi.fn(async () => true),
  waitFor: vi.fn(async () => true),
}));
vi.mock('./ui.js', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { step: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn() }),
}));
import { onboard } from './onboard.js';
import { compose, portFree, waitFor } from './stack.js';
import * as p from './ui.js';

const options = {
  yes: true,
  provider: 'offline' as const,
  adminEmail: 'root@example.com',
  adminName: 'Root',
  adminPassword: 'long-password',
  start: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.root = mkdtempSync(join(tmpdir(), 'lct-onboard-'));
  state.running = [];
  state.volume = false;
  writeFileSync(
    join(state.root, '.env.example'),
    'POSTGRES_PASSWORD=lct26-local\nPOSTGRES_PORT=5433\nWEB_SEARCH_URL=http://search:8080\n',
  );
  vi.mocked(portFree).mockResolvedValue(true);
  vi.mocked(compose).mockResolvedValue(0);
  vi.mocked(waitFor).mockResolvedValue(true);
});
afterEach(() => {
  rmSync(state.root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('server onboarding', () => {
  it('keeps a locally healthy domain installation successful while external HTTPS is unconfirmed', async () => {
    vi.mocked(waitFor)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    expect(await onboard({ ...options, domain: 'slides.example.com', start: true })).toBe(0);
    expect(waitFor).toHaveBeenCalledWith('https://slides.example.com/login', 60);
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining('HTTPS не удалось проверить'));
    expect(p.outro).toHaveBeenCalledWith('Установка готова · управление: lct');
    expect(EnvFile.open(join(state.root, '.env')).get('LCT_DOMAIN')).toBe('slides.example.com');
  });

  it('confirms reachable HTTPS without reporting an external availability warning', async () => {
    expect(await onboard({ ...options, domain: 'slides.example.com', start: true })).toBe(0);
    expect(waitFor).toHaveBeenCalledWith('https://slides.example.com/login', 60);
    expect(p.log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('HTTPS не удалось проверить'),
    );
  });

  it.each([0, 1])('still fails when local endpoint %i is unhealthy', async (failed) => {
    vi.mocked(waitFor)
      .mockResolvedValueOnce(failed !== 0)
      .mockResolvedValueOnce(failed !== 1);
    expect(await onboard({ ...options, domain: 'slides.example.com', start: true })).toBe(1);
    expect(waitFor).toHaveBeenCalledTimes(2);
  });

  it('installs noninteractively with unique credentials, ports and optional features', async () => {
    await expect(
      onboard({ ...options, docs: false, search: false, webPort: '3080', apiPort: '3081' }),
    ).resolves.toBe(0);
    const env = EnvFile.open(join(state.root, '.env'));
    expect(env.get('API_DOCS_ENABLED')).toBe('false');
    expect(env.get('WEB_SEARCH_URL')).toBe('');
    expect(env.get('WEB_PORT')).toBe('3080');
    expect(env.get('API_HOST_PORT')).toBe('3081');
    expect(env.get('SESSION_COOKIE_SECURE')).toBe('false');
    expect(env.get('MODEL_KEYS_SECRET')).toHaveLength(43);
    expect(env.get('POSTGRES_PASSWORD')).not.toBe('lct26-local');
    expect(compose).not.toHaveBeenCalled();
  });
  it('preserves encryption and database credentials on reconfiguration', async () => {
    await onboard(options);
    const first = EnvFile.open(join(state.root, '.env'));
    await onboard({ yes: true, section: 'settings', docs: true, start: false });
    const next = EnvFile.open(join(state.root, '.env'));
    for (const key of [
      'AUTH_SECRET',
      'API_SERVICE_TOKEN',
      'MODEL_KEYS_SECRET',
      'POSTGRES_PASSWORD',
      'ADMIN_PASSWORD',
    ])
      expect(next.get(key)).toBe(first.get(key));
    expect(next.get('API_DOCS_ENABLED')).toBe('true');
  });
  it('configures automatic HTTPS without publishing the application port publicly', async () => {
    await onboard({ ...options, domain: 'slides.example.com' });
    const env = EnvFile.open(join(state.root, '.env'));
    expect(env.get('COMPOSE_PROFILES')).toContain('https');
    expect(env.get('APP_ORIGIN')).toBe('https://slides.example.com');
    expect(env.get('SESSION_COOKIE_SECURE')).toBe('true');
    expect(env.get('WEB_BIND')).toBe('127.0.0.1');
  });
  it('rejects conflicting ports before writing any secrets', async () => {
    await expect(onboard({ ...options, webPort: '3001', apiPort: '3001' })).rejects.toThrow(
      /различаться/,
    );
    expect(existsSync(join(state.root, '.env'))).toBe(false);
  });
  it('rejects a port occupied by a different service before saving', async () => {
    vi.mocked(portFree).mockResolvedValue(false);
    await expect(onboard(options)).rejects.toThrow(/занят/);
    expect(existsSync(join(state.root, '.env'))).toBe(false);
  });
  it('requires an explicit model provider for unattended fresh installation', async () => {
    await expect(onboard({ ...options, provider: undefined })).rejects.toThrow(/--provider/);
    expect(existsSync(join(state.root, '.env'))).toBe(false);
  });
  it('does not generate credentials for a running database whose env was lost', async () => {
    state.running = ['postgres'];
    await expect(onboard(options)).rejects.toThrow(/Восстановите/);
    expect(existsSync(join(state.root, '.env'))).toBe(false);
  });
  it('does not generate credentials for a stopped database whose env was lost', async () => {
    state.volume = true;
    await expect(onboard(options)).rejects.toThrow(/Восстановите/);
    expect(existsSync(join(state.root, '.env'))).toBe(false);
  });
  it('applies feature removal before startup and retains configuration if startup fails', async () => {
    await onboard(options);
    state.running = ['api', 'web', 'search'];
    vi.mocked(compose).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await onboard({ yes: true, search: false, start: true })).toBe(1);
    expect(vi.mocked(compose).mock.calls[0]?.[0]).toEqual(['stop', 'search']);
    expect(vi.mocked(compose).mock.calls[1]?.[0]).toEqual(['up', '-d', '--build']);
    expect(readFileSync(join(state.root, '.env'), 'utf8')).toContain('WEB_SEARCH_URL=');
  });
});
