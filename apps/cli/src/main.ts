#!/usr/bin/env node
import { readRunConfig } from './config.js';

function main(argv: readonly string[]): number {
  const configPath = argv[2];
  if (configPath === undefined) {
    process.stderr.write('Usage: lct <path-to-run-config.yaml>\n');
    return 2;
  }

  try {
    const config = readRunConfig(configPath);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = main(process.argv);
