import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRunRepository } from './postgres-run-repository.js';
import { InvalidRunTransitionError } from './run-repository.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl === undefined ? describe.skip : describe;

describeWithPostgres('PostgresRunRepository integration', () => {
  const schema = `run_store_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let sequence = 0;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('applies all migrations idempotently', async () => {
    const repository = createRepository();
    await repository.migrate();
    await repository.migrate();

    const result = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${schema}.schema_migrations`,
    );
    expect(result.rows[0]?.count).toBe('3');
    await repository.close();
  });

  it('persists a queued run and reads it from another pool', async () => {
    const writer = createRepository();
    const reader = createRepository();
    await writer.migrate();

    const created = await writer.create();
    await expect(reader.get(created.runId)).resolves.toEqual(created);

    await Promise.all([writer.close(), reader.close()]);
  });

  it('records lifecycle timestamps for successful transitions', async () => {
    const repository = createRepository();
    const created = await repository.create();

    const running = await repository.transition(created.runId, 'running');
    const done = await repository.transition(created.runId, 'done');

    expect(running.startedAt).not.toBeNull();
    expect(done.startedAt).toBe(running.startedAt);
    expect(done.completedAt).not.toBeNull();
    await repository.close();
  });

  it('maps database transition constraints to a domain error', async () => {
    const repository = createRepository();
    const created = await repository.create();

    await expect(repository.transition(created.runId, 'done')).rejects.toBeInstanceOf(
      InvalidRunTransitionError,
    );
    await repository.close();
  });

  it('serializes concurrent transitions so only one terminal state wins', async () => {
    const repository = createRepository();
    const created = await repository.create();
    await repository.transition(created.runId, 'running');

    const results = await Promise.allSettled([
      repository.transition(created.runId, 'done'),
      repository.transition(created.runId, 'failed'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await repository.get(created.runId))?.state).toMatch(/^(done|failed)$/);
    await repository.close();
  });

  function createRepository(): PostgresRunRepository {
    sequence += 1;
    return new PostgresRunRepository({
      connectionString: withSearchPath(requiredDatabaseUrl(), schema),
      createId: () => `run-integration-${sequence}-${randomUUID()}`,
      maxConnections: 2,
    });
  }
});

function requiredDatabaseUrl(): string {
  if (databaseUrl === undefined) {
    throw new Error('RUN_STORE_TEST_DATABASE_URL is required for PostgreSQL integration tests.');
  }
  return databaseUrl;
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-csearch_path=${schema}`);
  return url.toString();
}
