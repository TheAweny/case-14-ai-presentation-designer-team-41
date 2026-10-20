import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRunConfig } from './config.js';
import { connectionOf, failureText, generateFromConfig, imageModelOf } from './generate.js';
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

describe('connectionOf', () => {
  const base = { LLM_BASE_URL: 'https://openrouter.ai/api/v1', LLM_MODEL: 'qwen/qwen3.8-27b' };

  it('tells the provider how the model turns its thinking off', () => {
    expect(connectionOf({ ...base, MODEL_REASONING_TOGGLE: 'reasoning-effort' }).reasoning).toEqual(
      { toggle: 'reasoning-effort', levels: false },
    );
    expect(connectionOf({ ...base, MODEL_REASONING_TOGGLE: 'enable-thinking' }).reasoning).toEqual({
      toggle: 'enable-thinking',
      levels: false,
    });
  });

  it('sends nothing about thinking when the switch is not known', () => {
    expect(connectionOf(base).reasoning).toEqual({ toggle: null, levels: false });
  });

  it('refuses a switch it does not know', () => {
    expect(() => connectionOf({ ...base, MODEL_REASONING_TOGGLE: 'off' })).toThrow(
      /MODEL_REASONING_TOGGLE/,
    );
  });
});

describe('imageModelOf', () => {
  const configured = {
    IMAGE_BASE_URL: 'https://images.example.test/v1',
    IMAGE_MODEL: 'flux',
    IMAGE_API_KEY: 'image-key',
    MODEL_API_KEY: 'text-key',
  };

  it('uses the image key and skips a disabled model the way the service does', () => {
    expect(imageModelOf(configured)).toEqual({
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'image-key',
      model: 'flux',
    });
    const textKey = imageModelOf({ ...configured, IMAGE_API_KEY: undefined });
    expect(textKey !== null && textKey !== 'fake' && textKey.apiKey).toBe('text-key');
    expect(imageModelOf({ ...configured, IMAGE_PROVIDER: 'disabled' })).toBeNull();
    expect(imageModelOf({ IMAGE_PROVIDER: 'fake', IMAGE_BASE_URL: 'x', IMAGE_MODEL: 'y' })).toBe(
      'fake',
    );
    expect(imageModelOf({ IMAGE_BASE_URL: 'https://images.example.test/v1' })).toBeNull();
  });
});

describe('failureText', () => {
  it('says what failed whatever the workflow threw', () => {
    expect(failureText(new Error('Model API HTTP 400'))).toBe('Model API HTTP 400');
    expect(failureText({ message: 'step failed', name: 'WorkflowError' })).toBe('step failed');
    expect(failureText('timeout')).toBe('timeout');
    expect(failureText({ code: 7 })).toBe('{"code":7}');
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

  it('names a brandbook that is not there before calling anything', async () => {
    await expect(
      generateFromConfig({
        config: {
          ...config,
          templatePath: join(__dirname, '..', '..', '..', 'examples', 'template.pptx'),
          contentPath: join(__dirname, '..', '..', '..', 'examples', 'brief.md'),
          brandbookPath: 'examples/missing-brandbook.zip',
        },
        configPath: 'x',
        env: { LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'm' },
        log: () => undefined,
      }),
    ).rejects.toThrow(/Брендбук не найден/);
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
