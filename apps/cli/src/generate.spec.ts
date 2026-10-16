import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRunConfig } from './config.js';
import { generateFromConfig } from './generate.js';
import { runEnv } from './generate-command.js';

let dir: string | null = null;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe('runEnv', () => {
  it('takes the model from .env over a variable left in the shell', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lct-env-'));
    await writeFile(
      join(dir, '.env'),
      '# comment\nLLM_MODEL=qwen38-27b-fp8\nMODEL_HEADERS=Project-ID=p-1\nEMPTY=\nQUOTED="x y"\n',
    );
    const env = runEnv(join(dir, '.env'), {
      LLM_MODEL: 'old-model',
      EMPTY: 'from-shell',
      PATH: '/bin',
    });
    expect(env).toMatchObject({
      LLM_MODEL: 'qwen38-27b-fp8',
      MODEL_HEADERS: 'Project-ID=p-1',
      QUOTED: 'x y',
      // An empty value in .env leaves the shell's, and the rest of the shell stays.
      EMPTY: 'from-shell',
      PATH: '/bin',
    });
  });

  it('is the shell alone without a .env', () => {
    expect(runEnv('/nowhere/.env', { A: '1' })).toEqual({ A: '1' });
  });
});

describe('generateFromConfig', () => {
  const config = readRunConfig(join(__dirname, '..', '..', '..', 'configs', 'run.example.yaml'));

  it('asks for the model of .env before anything else', async () => {
    await expect(
      generateFromConfig({ config, configPath: 'x', env: {}, log: () => undefined }),
    ).rejects.toThrow(/LLM_BASE_URL/);
  });

  it('says that recorded answers do not build decks', async () => {
    await expect(
      generateFromConfig({
        config,
        configPath: 'x',
        env: { MODEL_PROVIDER: 'fake' },
        log: () => undefined,
      }),
    ).rejects.toThrow(/lct onboard/);
  });

  it('names a template that is not there before calling anything', async () => {
    await expect(
      generateFromConfig({
        config: { ...config, templatePath: 'examples/missing.pptx' },
        configPath: 'x',
        env: { LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'm' },
        log: () => undefined,
      }),
    ).rejects.toThrow(/Шаблон не найден/);
  });

  it('refuses MODEL_HEADERS that do not read as headers', async () => {
    await expect(
      generateFromConfig({
        config,
        configPath: 'x',
        env: { LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'm', MODEL_HEADERS: 'Host=x' },
        log: () => undefined,
      }),
    ).rejects.toThrow(/MODEL_HEADERS/);
  });
});
