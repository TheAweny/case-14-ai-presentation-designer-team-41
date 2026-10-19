import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { jobEventSchema, type JobEvent } from '@lct/contracts';

export interface BuildVariant {
  variant: 'dense' | 'balanced' | 'airy';
  runId: string;
}
export interface BuildRecord {
  id: string;
  owner_id: string;
  spec_hash: string;
  spec: unknown;
  variants: BuildVariant[];
  status: 'running' | 'interrupted' | 'failed' | 'stopped' | 'done';
  fence: string;
  worker_id: string | null;
}
export interface BuildLease {
  build: BuildRecord;
  workerId: string;
  fence: string;
}
export class BuildConflictError extends Error {}

/** Product-level ownership; Mastra retains orchestration, the filesystem retains accepted tasks. */
export class GenerationBuildStore {
  constructor(private readonly pool: Pool) {}

  async create(
    ownerId: string,
    requestKey: string,
    specHash: string,
    spec: unknown,
  ): Promise<BuildRecord> {
    const id = randomUUID();
    const variants: BuildVariant[] = (['dense', 'balanced', 'airy'] as const).map((variant) => ({
      variant,
      runId: `run-${randomUUID()}`,
    }));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<BuildRecord>(
        `INSERT INTO generation_builds(id,owner_id,request_key,spec_hash,spec,variants)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) ON CONFLICT (owner_id,request_key) DO NOTHING RETURNING *`,
        [id, ownerId, requestKey, specHash, JSON.stringify(spec), JSON.stringify(variants)],
      );
      let build = inserted.rows[0];
      if (build) {
        for (const variant of variants)
          await client.query("INSERT INTO runs(id,state) VALUES ($1,'queued')", [variant.runId]);
      } else {
        const existing = await client.query<BuildRecord>(
          'SELECT * FROM generation_builds WHERE owner_id=$1 AND request_key=$2 FOR UPDATE',
          [ownerId, requestKey],
        );
        build = existing.rows[0];
        if (!build || build.spec_hash !== specHash)
          throw new BuildConflictError(
            'Запрос с этим идентификатором уже имеет другое содержание.',
          );
      }
      await client.query('COMMIT');
      return build;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(id: string, ownerId: string): Promise<BuildRecord | null> {
    const result = await this.pool.query<BuildRecord>(
      'SELECT * FROM generation_builds WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    );
    return result.rows[0] ?? null;
  }
  async byRequest(ownerId: string, requestKey: string): Promise<BuildRecord | null> {
    const result = await this.pool.query<BuildRecord>(
      'SELECT * FROM generation_builds WHERE owner_id=$1 AND request_key=$2',
      [ownerId, requestKey],
    );
    return result.rows[0] ?? null;
  }

  async claim(id: string, ownerId: string, includeStopped = false): Promise<BuildLease | null> {
    const workerId = randomUUID();
    const result = await this.pool.query<BuildRecord>(
      `UPDATE generation_builds SET worker_id=$3, fence=fence+1, lease_until=now()+interval '30 seconds', status='running', updated_at=now()
       WHERE id=$1 AND owner_id=$2 AND status<>'done' AND (status<>'stopped' OR $4)
         AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
      [id, ownerId, workerId, includeStopped],
    );
    const build = result.rows[0];
    return build ? { build, workerId, fence: build.fence } : null;
  }

  async assert(lease: BuildLease): Promise<void> {
    const result = await this.pool.query(
      `SELECT id FROM generation_builds WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_until>now()`,
      [lease.build.id, lease.workerId, lease.fence],
    );
    if (!result.rowCount) throw new BuildConflictError('Исполнитель сборки потерял право записи.');
  }

  async renew(lease: BuildLease): Promise<void> {
    const result = await this.pool.query(
      `UPDATE generation_builds SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_until>now()`,
      [lease.build.id, lease.workerId, lease.fence],
    );
    if (!result.rowCount) throw new BuildConflictError('Право выполнения сборки истекло.');
  }

  async finish(lease: BuildLease, status: 'done' | 'failed' | 'interrupted'): Promise<void> {
    const result = await this.pool.query(
      `WITH finished AS (UPDATE generation_builds SET status=$4,worker_id=NULL,lease_until=NULL,updated_at=now()
       WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_until>now() RETURNING id),
       accounted AS (UPDATE account_operations SET status=CASE WHEN $4='done' THEN 'completed' ELSE 'released' END,
         completed_at=CASE WHEN $4='done' THEN now() ELSE NULL END,worker_id=NULL,lease_until=NULL,updated_at=now()
         WHERE operation_id IN (SELECT id::text FROM finished) AND status='active') SELECT id FROM finished`,
      [lease.build.id, lease.workerId, lease.fence, status],
    );
    if (!result.rowCount)
      throw new BuildConflictError('Завершение устаревшего исполнителя отклонено.');
  }

  async stop(id: string, ownerId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stopped = await client.query<{ variants: BuildVariant[] }>(
        `UPDATE generation_builds SET status='stopped',fence=fence+1,worker_id=NULL,lease_until=NULL,updated_at=now()
         WHERE id=$1 AND owner_id=$2 AND status NOT IN ('done','stopped') RETURNING variants`,
        [id, ownerId],
      );
      for (const variant of stopped.rows[0]?.variants ?? []) {
        const run = await client.query<{ state: string }>(
          'SELECT state FROM runs WHERE id=$1 FOR UPDATE',
          [variant.runId],
        );
        if (run.rows[0]?.state === 'done' || run.rows[0]?.state === 'failed') continue;
        const last = await client.query<{ sequence: number }>(
          'SELECT sequence FROM run_events WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',
          [variant.runId],
        );
        const event = jobEventSchema.parse({
          schemaVersion: 1,
          runId: variant.runId,
          seq: (last.rows[0]?.sequence ?? -1) + 1,
          at: new Date().toISOString(),
          type: 'failed',
          stage: 'queued',
          code: 'cancelled',
          message: 'Сборка остановлена. Сохранённые результаты доступны для явного продолжения.',
          retryable: true,
        });
        await client.query(
          `INSERT INTO run_events(run_id,sequence,stage,status,message,payload) VALUES($1,$2,'queued','failed',$3,$4::jsonb)`,
          [
            variant.runId,
            event.seq,
            'message' in event ? event.message : '',
            JSON.stringify(event),
          ],
        );
        await client.query(
          "UPDATE runs SET state='failed',completed_at=now(),updated_at=now() WHERE id=$1",
          [variant.runId],
        );
      }
      if (stopped.rowCount)
        await client.query(
          "UPDATE account_operations SET status='released',worker_id=NULL,lease_until=NULL,updated_at=now() WHERE operation_id=$1 AND owner_id=$2 AND status='active'",
          [id, ownerId],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Fence check, filesystem publication, event and run state share the same ownership lock. */
  async publish(lease: BuildLease, event: JobEvent, files?: () => Promise<void>): Promise<void> {
    const parsed = jobEventSchema.parse(event);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owned = await client.query(
        `SELECT id FROM generation_builds WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_until>now() FOR UPDATE`,
        [lease.build.id, lease.workerId, lease.fence],
      );
      if (!owned.rowCount)
        throw new BuildConflictError('Запись устаревшего исполнителя отклонена.');
      if (!lease.build.variants.some((entry) => entry.runId === event.runId))
        throw new BuildConflictError('Прогон не принадлежит сборке.');
      await client.query('SELECT id FROM runs WHERE id=$1 FOR UPDATE', [event.runId]);
      const previous = await client.query<{ sequence: number }>(
        'SELECT sequence FROM run_events WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1',
        [event.runId],
      );
      if (parsed.seq !== (previous.rows[0]?.sequence ?? -1) + 1)
        throw new BuildConflictError('Нарушена последовательность событий.');
      await files?.();
      const stage = 'stage' in parsed ? parsed.stage : 'queued';
      const status =
        parsed.type === 'failed'
          ? 'failed'
          : parsed.type.endsWith('finished') || parsed.type === 'done'
            ? 'completed'
            : 'started';
      const message = 'message' in parsed ? parsed.message : 'note' in parsed ? parsed.note : null;
      await client.query(
        'INSERT INTO run_events(run_id,sequence,stage,status,message,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
        [parsed.runId, parsed.seq, stage, status, message, JSON.stringify(parsed)],
      );
      if (parsed.type === 'done')
        await client.query(
          "UPDATE runs SET state='done',completed_at=now(),updated_at=now() WHERE id=$1",
          [parsed.runId],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async hasLiveLease(id: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT id FROM generation_builds WHERE id=$1 AND status='running' AND lease_until>now()",
      [id],
    );
    return Boolean(result.rowCount);
  }
}
