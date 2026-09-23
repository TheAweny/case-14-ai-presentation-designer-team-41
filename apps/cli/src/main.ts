#!/usr/bin/env node
import { RunRepository, type LocalRun } from '@lct/run-store';
import { readRunConfig } from './config.js';

export async function initializeRun(
  configPath: string,
  createId?: () => string,
): Promise<LocalRun> {
  const config = readRunConfig(configPath);
  return new RunRepository(config.outputDir, createId).create();
}

async function main(argv: readonly string[]): Promise<number> {
  const configPath = argv[2];
  if (configPath === undefined) {
    process.stderr.write('Usage: lct <path-to-run-config.yaml>\n');
    return 2;
  }

  try {
    const run = await initializeRun(configPath);
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
