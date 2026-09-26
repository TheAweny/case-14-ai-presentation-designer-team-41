#!/usr/bin/env node
import type { JobEvent } from '@lct/contracts';
import { PostgresRunRepository, type RunRecord } from '@lct/run-store';
import { validateLocalRunInputs } from '@lct/input-validation';
import { readRunConfig } from './config.js';

export async function initializeRun(
  configPath: string,
  connectionString = process.env.DATABASE_URL,
  createId?: () => string,
): Promise<RunRecord> {
  const config = readRunConfig(configPath);
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  validateLocalRunInputs(config);
  const repository = new PostgresRunRepository({ connectionString, createId });
  try {
    await repository.migrate();
    return await repository.create();
  } finally {
    await repository.close();
  }
}

export async function readRunEvents(
  runId: string,
  connectionString = process.env.DATABASE_URL,
  afterSequence = -1,
): Promise<readonly JobEvent[]> {
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
  }
  const repository = new PostgresRunRepository({ connectionString });
  try {
    await repository.migrate();
    return await repository.events(runId, afterSequence);
  } finally {
    await repository.close();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv[2] === 'events') {
    const runId = argv[3];
    if (runId === undefined) {
      process.stderr.write('Usage: lct events <run-id> [after-sequence]\n');
      return 2;
    }
    try {
      const after = argv[4] === undefined ? -1 : Number(argv[4]);
      if (!Number.isInteger(after) || after < -1) {
        throw new Error('after-sequence must be an integer >= -1.');
      }
      const events = await readRunEvents(runId, undefined, after);
      process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

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
