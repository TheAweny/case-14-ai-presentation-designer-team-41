import { randomUUID } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import {
  InvalidRunTransitionError,
  RunNotFoundError,
  type RunRecord,
  type RunRepository,
  type RunState,
} from './run-repository.js';

const runIdPattern = /^[a-z][a-z0-9-]*$/;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export interface PostgresRunRepositoryOptions {
  readonly connectionString: string;
  readonly createId?: () => string;
  readonly maxConnections?: number;
}

interface RunRow {
  readonly id: string;
  readonly state: RunState;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
}

export class PostgresRunRepository implements RunRepository {
  private readonly pool: Pool;
  private readonly createId: () => string;
  private closed = false;

  constructor(options: PostgresRunRepositoryOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
    this.createId = options.createId ?? (() => `run-${randomUUID()}`);
  }

  async migrate(): Promise<void> {
    const migrationsDirectory = await resolveMigrationsDirectory();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [260923]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const entries = (await readdir(migrationsDirectory))
        .filter((name) => name.endsWith('.sql'))
        .sort();
      for (const version of entries) {
        const applied = await client.query<{ version: string }>(
          'SELECT version FROM schema_migrations WHERE version = $1',
          [version],
        );
        if (applied.rowCount !== 0) {
          continue;
        }
        await client.query(await readFile(join(migrationsDirectory, version), 'utf8'));
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async create(): Promise<RunRecord> {
    const runId = this.createId();
    this.assertRunId(runId);
    const result = await this.pool.query<RunRow>(
      `INSERT INTO runs(id, state) VALUES ($1, 'queued')
       RETURNING id, state, created_at, updated_at, started_at, completed_at`,
      [runId],
    );
    return this.mapRow(this.requiredRow(result.rows[0]));
  }

  async get(runId: string): Promise<RunRecord | null> {
    this.assertRunId(runId);
    const result = await this.pool.query<RunRow>(
      `SELECT id, state, created_at, updated_at, started_at, completed_at
       FROM runs WHERE id = $1`,
      [runId],
    );
    const row = result.rows[0];
    return row === undefined ? null : this.mapRow(row);
  }

  async transition(runId: string, state: RunState): Promise<RunRecord> {
    this.assertRunId(runId);
    const client = await this.pool.connect();
    let current: RunRow | undefined;
    try {
      await client.query('BEGIN');
      current = await this.selectForUpdate(client, runId);
      if (current === undefined) {
        throw new RunNotFoundError(runId);
      }

      const updated = await client.query<RunRow>(
        `UPDATE runs
         SET state = $2::run_state,
             updated_at = now(),
             started_at = CASE
               WHEN $2::run_state = 'running' THEN COALESCE(started_at, now())
               ELSE started_at
             END,
             completed_at = CASE
               WHEN $2::run_state IN ('done', 'failed') THEN now()
               ELSE completed_at
             END
         WHERE id = $1
         RETURNING id, state, created_at, updated_at, started_at, completed_at`,
        [runId, state],
      );
      await client.query('COMMIT');
      return this.mapRow(this.requiredRow(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      if (current !== undefined && this.isTransitionViolation(error)) {
        throw new InvalidRunTransitionError(runId, current.state, state);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  private async selectForUpdate(client: PoolClient, runId: string): Promise<RunRow | undefined> {
    const result = await client.query<RunRow>(
      `SELECT id, state, created_at, updated_at, started_at, completed_at
       FROM runs WHERE id = $1 FOR UPDATE`,
      [runId],
    );
    return result.rows[0];
  }

  private mapRow(row: RunRow): RunRecord {
    return {
      runId: row.id,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  private requiredRow(row: RunRow | undefined): RunRow {
    if (row === undefined) {
      throw new Error('PostgreSQL did not return the expected run row.');
    }
    return row;
  }

  private assertRunId(runId: string): void {
    if (!runIdPattern.test(runId)) {
      throw new Error(`Invalid run id: ${runId}`);
    }
  }

  private isTransitionViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'constraint' in error &&
      error.constraint === 'runs_state_transition'
    );
  }
}

async function resolveMigrationsDirectory(): Promise<string> {
  const candidates = [
    join(moduleDirectory, 'migrations'),
    join(moduleDirectory, '..', 'migrations'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('PostgreSQL migrations directory was not found in the run-store package.');
}
