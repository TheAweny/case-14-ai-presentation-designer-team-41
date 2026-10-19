import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { BuildLease } from './generation-build-store.js';

export interface AttemptIntent {
  taskKey: string;
  modelId: string;
  kind: string;
  reservedTokens: number;
  estimatedCost: number | null;
  pricingVersion: string | null;
  currency: string | null;
}
export interface AttemptOutcome {
  status: string;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  actualCost: number | null;
}
export interface UsageLimits {
  requests: number;
  tokens: number;
  cost: number | null;
  currency?: string;
}
export class UsageBudgetError extends Error {
  readonly code = 'usage-budget-exceeded';
}

/** A pending/unknown charge conservatively keeps its reservation on subsequent resumes. */
export class PostgresProviderLedger {
  constructor(
    private readonly pool: Pool,
    private readonly ownerId: string,
    private readonly lease: BuildLease | null,
    private readonly limits: UsageLimits,
  ) {}

  async begin(intent: AttemptIntent): Promise<string> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const scope = this.lease?.build.id ?? `chat:${this.ownerId}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [scope]);
      if (this.lease) {
        const owned = await client.query(
          `SELECT id FROM generation_builds WHERE id=$1 AND worker_id=$2 AND fence=$3 AND status='running' AND lease_until>now() FOR UPDATE`,
          [this.lease.build.id, this.lease.workerId, this.lease.fence],
        );
        if (!owned.rowCount) throw new Error('Право отправки запроса истекло.');
      }
      const totals = await client.query<{
        requests: string;
        tokens: string;
        cost: string;
        unknown_cost: boolean;
      }>(
        `SELECT count(*) AS requests, COALESCE(sum(COALESCE(input_tokens+output_tokens,reserved_tokens)),0) AS tokens,
          COALESCE(sum(COALESCE(actual_cost,estimated_cost)),0) AS cost,
          COALESCE(bool_or(actual_cost IS NULL AND estimated_cost IS NULL),false) AS unknown_cost
         FROM provider_attempts WHERE ${this.lease ? 'build_id=$1' : 'build_id IS NULL AND owner_id=$1'}`,
        [this.lease?.build.id ?? this.ownerId],
      );
      const used = totals.rows[0];
      if (!used) throw new Error('Usage totals unavailable');
      if (
        Number(used.requests) + 1 > this.limits.requests ||
        Number(used.tokens) + intent.reservedTokens > this.limits.tokens
      )
        throw new UsageBudgetError('Исчерпан общий бюджет запросов или токенов сборки.');
      if (
        this.limits.cost !== null &&
        (intent.currency !== this.limits.currency ||
          intent.estimatedCost === null ||
          used.unknown_cost ||
          Number(used.cost) + intent.estimatedCost > this.limits.cost)
      )
        throw new UsageBudgetError('Стоимость неизвестна или превышает согласованный бюджет.');
      await client.query(
        `INSERT INTO provider_attempts(id,build_id,owner_id,task_key,model_id,kind,reserved_tokens,estimated_cost,pricing_version,currency)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          this.lease?.build.id ?? null,
          this.ownerId,
          intent.taskKey,
          intent.modelId,
          intent.kind,
          intent.reservedTokens,
          intent.estimatedCost,
          intent.pricingVersion,
          intent.currency,
        ],
      );
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async end(id: string, outcome: AttemptOutcome): Promise<void> {
    const result = await this.pool.query(
      `UPDATE provider_attempts SET status=$3,http_status=$4,input_tokens=$5,output_tokens=$6,actual_cost=$7,finished_at=now()
       WHERE id=$1 AND owner_id=$2 AND status='pending' RETURNING id`,
      [
        id,
        this.ownerId,
        outcome.status,
        outcome.httpStatus,
        outcome.inputTokens,
        outcome.outputTokens,
        outcome.actualCost,
      ],
    );
    if (!result.rowCount) throw new Error('Журнал попытки не удалось завершить.');
  }

  async summary() {
    const result = await this.pool.query(
      `SELECT count(*)::int AS requests, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
        count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown_usage,
        sum(actual_cost) AS known_cost, count(*) FILTER(WHERE actual_cost IS NULL)::int AS unknown_cost,
        min(created_at) AS started_at,max(COALESCE(finished_at,created_at)) AS updated_at
       FROM provider_attempts WHERE ${this.lease ? 'build_id=$1' : 'build_id IS NULL AND owner_id=$1'}`,
      [this.lease?.build.id ?? this.ownerId],
    );
    return result.rows[0];
  }
}
