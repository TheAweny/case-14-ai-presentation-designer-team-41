#!/usr/bin/env node
import { PostgresRunRepository, type RunRecord } from '@lct/run-store';
import { readRunConfig } from './config.js';

export async function initializeRun(
  configPath: string,
  connectionString = process.env.DATABASE_URL,
  createId?: () => string,
): Promise<RunRecord> {
  readRunConfig(configPath);
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  const repository = new PostgresRunRepository({ connectionString, createId });
  try {
    await repository.migrate();
    return await repository.create();
  } finally {
    await repository.close();
  }
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
