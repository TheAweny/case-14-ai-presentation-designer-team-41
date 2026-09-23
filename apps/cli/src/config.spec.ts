import { describe, expect, it } from 'vitest';
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

  it('fails on a config file that does not exist', () => {
    expect(() => readRunConfig('configs/missing.yaml')).toThrowError();
  });
});

describe('local run initialization', () => {
  it('creates an isolated queued run under the configured output directory', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(resolve(tmpdir(), 'lct-cli-run-'));
    const configPath = resolve(root, 'run.yaml');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      configPath,
      `templatePath: template.pptx\ncontentPath: content.md\nslideCount: 10\nlayoutVariants: [balanced]\nauditProfile: default\nmodels: [{ role: planner, modelId: planner-default }]\nseed: 1\noutputDir: ${root}/runs\n`,
    );

    try {
      const { initializeRun } = await import('./main.js');
      const run = await initializeRun(configPath, () => 'run-cli');
      expect(run).toMatchObject({ runId: 'run-cli', state: 'queued' });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
