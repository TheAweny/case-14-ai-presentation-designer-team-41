import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { EnvFile } from './env-file.js';
import { aiStudio, checkModel, offline, projectIdProblem, vkAiSpace } from './models.js';
import { ensureInstallationSecrets, isUsableSecret } from './secrets.js';
import { emailProblem, formatUsers, parseUsers, passwordProblem, upsertUser } from './users.js';

describe('EnvFile', () => {
  it('changes values in place and keeps comments, order and the file private', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'));
    writeFileSync(
      join(dir, '.env.example'),
      '# Key for the runtime.\nMODEL_API_KEY=\n# Port.\nAPI_PORT=3001\n',
    );
    const env = EnvFile.open(join(dir, '.env'), join(dir, '.env.example'));
    env.set('MODEL_API_KEY', 'secret');
    env.set('AUTH_SECRET', 'abc');
    env.save();
    const text = readFileSync(join(dir, '.env'), 'utf8');
    expect(text).toBe(
      '# Key for the runtime.\nMODEL_API_KEY=secret\n# Port.\nAPI_PORT=3001\nAUTH_SECRET=abc\n',
    );
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(EnvFile.open(join(dir, '.env')).get('API_PORT')).toBe('3001');
  });

  it('refuses a value that would break the file', () => {
    const env = EnvFile.open(join(tmpdir(), 'none.env'));
    expect(() => env.set('X', 'a\nb')).toThrow();
  });
});

describe('installation secrets', () => {
  it('creates each secret once and keeps it on the next run', () => {
    const env = EnvFile.open(join(tmpdir(), 'secrets-none.env'));
    let n = 0;
    const generate = () => `generated-secret-${++n}-${'x'.repeat(40)}`;
    expect(ensureInstallationSecrets(env, generate)).toEqual([
      'AUTH_SECRET',
      'API_SERVICE_TOKEN',
      'MODEL_KEYS_SECRET',
    ]);
    const first = env.text();
    expect(ensureInstallationSecrets(env, generate)).toEqual([]);
    expect(env.text()).toBe(first);
  });

  it('replaces values anyone could know: empty, short or copied from the docs', () => {
    expect(isUsableSecret('')).toBe(false);
    expect(isUsableSecret('change-me')).toBe(false);
    expect(isUsableSecret('lct26-local-auth-secret-change-me')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'env-'));
    writeFileSync(join(dir, '.env.example'), 'AUTH_SECRET=lct26-local-auth-secret-change-me\n');
    const env = EnvFile.open(join(dir, '.env'), join(dir, '.env.example'));
    ensureInstallationSecrets(env);
    expect(env.get('AUTH_SECRET')).not.toBe('lct26-local-auth-secret-change-me');
    expect(isUsableSecret(env.get('AUTH_SECRET'))).toBe(true);
    expect(isUsableSecret(env.get('MODEL_KEYS_SECRET'))).toBe(true);
  });
});

describe('users', () => {
  it('reads and writes the format the web app reads', () => {
    const users = parseUsers('Admin@Example.com:secret123:Ann Lee;bad-entry;x@y.z:pw12345678');
    expect(users).toEqual([
      { email: 'admin@example.com', password: 'secret123', name: 'Ann Lee' },
      { email: 'x@y.z', password: 'pw12345678', name: 'x' },
    ]);
    expect(parseUsers(formatUsers(users))).toEqual(users);
  });

  it('adds a user or replaces the one with the same email', () => {
    const users = parseUsers('a@b.co:old-password:A');
    const next = upsertUser(users, { email: 'A@B.co', password: 'new-password', name: 'A' });
    expect(next).toEqual([{ email: 'a@b.co', password: 'new-password', name: 'A' }]);
  });

  it('refuses passwords and emails that would break the list', () => {
    expect(passwordProblem('short')).toBeDefined();
    expect(passwordProblem('has:colon')).toBeDefined();
    expect(passwordProblem('long-enough')).toBeUndefined();
    expect(emailProblem('no-at')).toBeDefined();
    expect(emailProblem('ann@example.com')).toBeUndefined();
  });
});

describe('parseArgs', () => {
  it('reads flags with values, bare flags and positional arguments', () => {
    expect(parseArgs(['add', 'a@b.co', '--name', 'Ann', '--yes', '--mode=docker'])).toEqual({
      args: ['add', 'a@b.co'],
      flags: { name: 'Ann', yes: 'true', mode: 'docker' },
    });
  });
});

describe('models', () => {
  it('fills the AI Studio preset from a key and a folder id', () => {
    const settings = aiStudio(' key ', 'b1gaaaaaaaaaaaaaaaaa');
    expect(settings.LLM_MODEL).toBe(
      'gpt://b1gaaaaaaaaaaaaaaaaa/qwen3-30b-a3b-instruct-2507/latest',
    );
    expect(settings.MODEL_API_KEY).toBe('key');
    expect(settings.VLM_BASE_URL).toBe(settings.LLM_BASE_URL);
  });

  it('checks a live model with one short call, thinking off', async () => {
    let body: Record<string, unknown> = {};
    const ok = await checkModel(aiStudio('k', 'b1gaaaaaaaaaaaaaaaaa'), (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] })),
      );
    });
    expect(ok.ok).toBe(true);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('reports a rejected key with its status', async () => {
    const bad = await checkModel(aiStudio('k', 'b1gaaaaaaaaaaaaaaaaa'), () =>
      Promise.resolve(new Response('unauthorized', { status: 401 })),
    );
    expect(bad).toMatchObject({ ok: false });
    expect(bad.detail).toMatch(/401/);
  });

  it('fills the VK AI Space preset from a key and a project id alone', () => {
    const settings = vkAiSpace(' key ', ' 0b5e0000-0000-4000-8000-000000000001 ');
    expect(settings).toMatchObject({
      LLM_MODEL: 'qwen38-27b-fp8',
      VLM_MODEL: 'qwen38-27b-fp8',
      MODEL_API_KEY: 'key',
      MODEL_HEADERS: 'Project-ID=0b5e0000-0000-4000-8000-000000000001',
    });
    expect(settings.LLM_BASE_URL).toMatch(/^https:\/\/ai-demo\.platformpreview\.ru\/.*\/v1$/);
    expect(settings.VLM_BASE_URL).toBe(settings.LLM_BASE_URL);
    expect(projectIdProblem('0b5e0000-0000-4000-8000-000000000001')).toBeUndefined();
    expect(projectIdProblem('not a project')).toMatch(/UUID/);
  });

  it('checks VK AI Space with its project header', async () => {
    let headers: HeadersInit | undefined;
    await checkModel(vkAiSpace('k', '0b5e0000-0000-4000-8000-000000000001'), (_url, init) => {
      headers = init?.headers;
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] })),
      );
    });
    expect(headers).toMatchObject({
      'Project-ID': '0b5e0000-0000-4000-8000-000000000001',
      authorization: 'Bearer k',
    });
  });

  it('needs nothing to check offline', async () => {
    await expect(checkModel(offline())).resolves.toMatchObject({ ok: true });
  });
});
