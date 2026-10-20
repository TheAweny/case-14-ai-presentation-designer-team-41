import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRunConfig } from './config.js';

describe('readRunConfig', () => {
  it('parses the example config shipped in configs/', () => {
    const config = readRunConfig(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../configs/run.example.yaml'),
    );
    expect(config.slideCount).toBeGreaterThanOrEqual(10);
    expect(config.layoutVariants.length).toBeGreaterThan(0);
  });

  it('parses the data and brandbook example, whose files are in the repository', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const config = readRunConfig(resolve(root, 'configs/run.data-brand.yaml'));
    expect(config.brandbookPath).toBe('examples/brandbooks/northstar-brandbook.zip');
    expect(config.brandbookPriority).toBe('brandbook');
    for (const path of [config.templatePath, config.contentPath, config.brandbookPath ?? ''])
      expect(existsSync(resolve(root, path)), path).toBe(true);
  });

  it('fails on a config file that does not exist', () => {
    expect(() => readRunConfig('configs/missing.yaml')).toThrowError();
  });
});

describe('database configuration', () => {
  it('fails clearly when PostgreSQL is not configured', async () => {
    const { initializeRun } = await import('./main.js');
    const configPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../configs/run.example.yaml',
    );
    await expect(initializeRun(configPath, '')).rejects.toThrow('DATABASE_URL is required');
  });
});
