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
