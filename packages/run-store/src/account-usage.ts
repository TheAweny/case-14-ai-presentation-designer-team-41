import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  accountPolicySchema,
  type AccountPolicy,
  type AccountLimit,
  type OperationMetric,
  type PolicyMetric,
} from '@lct/contracts';

export class AccountLimitError extends Error {
  readonly code = 'account-limit';
  constructor(
    readonly metric: PolicyMetric,
    readonly resetsAt: string | null,
  ) {
    super('Достигнут лимит, установленный администратором. Готовые результаты доступны.');
  }
}
export class AccountDisabledError extends Error {
  readonly code = 'account-disabled';
}
/** UTC boundaries of the explicitly selected civil period, including DST transitions. */
export function policyWindow(limit: AccountLimit | null | undefined, now = new Date()) {
  if (!limit || limit.period === 'lifetime') return { start: new Date(0).toISOString(), end: null };
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: limit.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const label = (time: number) => {
    const parts = formatter.formatToParts(time);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}${limit.period === 'day' ? `-${get('day')}` : ''}`;
  };
  const current = label(now.getTime());
  const boundary = (first: boolean) => {
    let low = now.getTime() - (limit.period === 'day' ? 3 : 40) * 86400000;
    let high = now.getTime() + (limit.period === 'day' ? 3 : 40) * 86400000;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (first ? label(middle) >= current : label(middle) > current) high = middle;
      else low = middle;
    }
    return new Date(high).toISOString();
  };
  return { start: boundary(true), end: boundary(false) };
}
type Queryable = Pick<PoolClient, 'query'>;
export async function effectivePolicy(
  db: Queryable,
  ownerId: string,
): Promise<{ defaults: AccountPolicy; override: AccountPolicy; effective: AccountPolicy }> {
  const result = await db.query<{ scope: string; policy: unknown }>(
    'SELECT scope,policy FROM account_policies WHERE scope IN ($1,$2)',
    ['default', ownerId],
  );
  const defaults = accountPolicySchema.parse(
    result.rows.find((row) => row.scope === 'default')?.policy ?? {},
  );
  const override = accountPolicySchema.parse(
    result.rows.find((row) => row.scope === ownerId)?.policy ?? {},
  );
  return { defaults, override, effective: { ...defaults, ...override } };
}
export async function assertAccountEnabled(db: Queryable, ownerId: string) {
  const row = await db.query('SELECT id FROM app_users WHERE id=$1 AND disabled_at IS NULL', [
    ownerId,
  ]);
  if (!row.rowCount)
    throw new AccountDisabledError('Аккаунт отключён. Готовые результаты сохранены.');
}
/** Account-wide transaction lock serializes admissions across replicas and model connections. */
export class AccountUsageStore {
  constructor(readonly pool: Pool) {}
  async transaction<T>(ownerId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `account-usage:${ownerId}`,
      ]);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async setPolicy(scope: string, value: unknown, actorId: string) {
    const policy = accountPolicySchema.parse(value);
    return this.transaction(scope, async (client) => {
      const actor = await client.query(
        "SELECT id FROM app_users WHERE id=$1 AND role='admin' AND disabled_at IS NULL FOR SHARE",
        [actorId],
      );
      if (!actor.rowCount) throw new Error('Только администратор меняет ограничения.');
      const previous = await client.query(
        'SELECT policy FROM account_policies WHERE scope=$1 FOR UPDATE',
        [scope],
      );
      await client.query(
        'INSERT INTO account_policies(scope,policy) VALUES($1,$2::jsonb) ON CONFLICT(scope) DO UPDATE SET policy=excluded.policy,updated_at=now()',
        [scope, JSON.stringify(policy)],
      );
      await client.query(
        'INSERT INTO account_policy_audit(actor_id,scope,before_policy,after_policy) VALUES($1,$2,$3::jsonb,$4::jsonb)',
        [actorId, scope, JSON.stringify(previous.rows[0]?.policy ?? {}), JSON.stringify(policy)],
      );
      return policy;
    });
  }
  /** Expiry alone never frees a potentially live operation. Reconcile from durable owner state. */
  async reconcile(client: Queryable, ownerId: string) {
    await client.query(
      `UPDATE account_operations o SET status=CASE WHEN b.status='done' THEN 'completed' ELSE 'released' END,
      completed_at=CASE WHEN b.status='done' THEN now() ELSE NULL END,updated_at=now()
      FROM generation_builds b WHERE o.operation_id=b.id::text AND o.owner_id=$1 AND o.status='active'
      AND (b.status IN ('done','failed','stopped','interrupted') OR (b.status='running' AND (b.lease_until IS NULL OR b.lease_until<now())))
      AND NOT (b.status='running' AND b.lease_until>now())`,
      [ownerId],
    );
    const expired = await client.query(
      `SELECT operation_id,metric FROM account_operations
      WHERE owner_id=$1 AND metric<>'generation' AND status='active' AND lease_until<now() FOR UPDATE`,
      [ownerId],
    );
    for (const operation of expired.rows) {
      // A delayed heartbeat is not evidence of a crash. Take the actual execution lock first.
      const chat =
        operation.metric === 'assistant-response'
          ? /^chat:([^:]+):/.exec(operation.operation_id)
          : null;
      const edit =
        operation.metric === 'edit'
          ? operation.operation_id.slice(`edit:${ownerId}:`.length).split(':')[0]
          : null;
      if (chat || edit) {
        const acquired = await client.query(
          `SELECT pg_try_advisory_xact_lock(${chat ? 'hashtextextended($1,0)' : 'hashtext($1)'}) AS acquired`,
          [chat ? `chat:${chat[1]}` : `editor:${ownerId}:${edit}`],
        );
        if (!acquired.rows[0].acquired) continue;
      }
      await client.query(
        `UPDATE account_operations SET status='released',worker_id=NULL,lease_until=NULL,updated_at=now()
        WHERE operation_id=$1 AND owner_id=$2 AND status='active'`,
        [operation.operation_id, ownerId],
      );
    }
  }
  async admit(ownerId: string, operationId: string, metric: OperationMetric, now = new Date()) {
    return this.transaction(ownerId, async (client) => {
      await assertAccountEnabled(client, ownerId);
      await this.reconcile(client, ownerId);
      const existing = await client.query(
        'SELECT * FROM account_operations WHERE operation_id=$1 FOR UPDATE',
        [operationId],
      );
      const old = existing.rows[0];
      if (old && (old.owner_id !== ownerId || old.metric !== metric))
        throw new Error('Operation ownership mismatch');
      if (old?.status === 'completed' || old?.status === 'active')
        return old.worker_id as string | null;
      const { effective } = await effectivePolicy(client, ownerId);
      const limit = effective[metric];
      const window = policyWindow(limit, now);
      if (limit) {
        const used = await client.query(
          `SELECT count(*)::int AS n FROM account_operations WHERE owner_id=$1 AND metric=$2
          AND status IN ('active','completed') AND admitted_at >= $3 AND ($4::timestamptz IS NULL OR admitted_at<$4)`,
          [ownerId, metric, window.start, window.end],
        );
        if (used.rows[0].n >= limit.limit) throw new AccountLimitError(metric, window.end);
      }
      if (metric === 'generation' && effective.concurrency) {
        const used = await client.query(
          "SELECT count(*)::int AS n FROM account_operations WHERE owner_id=$1 AND metric='generation' AND status='active'",
          [ownerId],
        );
        if (used.rows[0].n >= effective.concurrency.limit)
          throw new AccountLimitError('concurrency', null);
      }
      const worker = randomUUID();
      await client.query(
        `INSERT INTO account_operations(operation_id,owner_id,metric,status,admitted_at,admission_window,worker_id,lease_until)
        VALUES($1,$2,$3,'active',$4,$5::jsonb,$6,now()+interval '60 seconds') ON CONFLICT(operation_id) DO UPDATE
        SET status='active',admitted_at=excluded.admitted_at,admission_window=excluded.admission_window,worker_id=$6,lease_until=excluded.lease_until,updated_at=now()`,
        [operationId, ownerId, metric, now.toISOString(), JSON.stringify(window), worker],
      );
      return worker;
    });
  }
  async renew(ownerId: string, operationId: string, worker: string) {
    await assertAccountEnabled(this.pool, ownerId);
    const result = await this.pool.query(
      "UPDATE account_operations SET lease_until=now()+interval '60 seconds' WHERE operation_id=$1 AND owner_id=$2 AND worker_id=$3 AND status='active'",
      [operationId, ownerId, worker],
    );
    if (!result.rowCount) throw new Error('Operation lease lost');
  }
  async bindResult(ownerId: string, operationId: string, worker: string, resultId: string) {
    await this.pool.query(
      "UPDATE account_operations SET result_ref=$4 WHERE operation_id=$1 AND owner_id=$2 AND worker_id=$3 AND status='active'",
      [operationId, ownerId, worker, resultId],
    );
  }
  async finish(ownerId: string, operationId: string, success: boolean, worker?: string | null) {
    return this.transaction(ownerId, async (client) => {
      await client.query(
        `UPDATE account_operations SET status=$3,completed_at=CASE WHEN $3='completed' THEN now() ELSE NULL END,
        worker_id=NULL,lease_until=NULL,updated_at=now() WHERE operation_id=$1 AND owner_id=$2 AND status='active'
        AND ($4::text IS NULL OR worker_id=$4)`,
        [operationId, ownerId, success ? 'completed' : 'released', worker ?? null],
      );
    });
  }
  async view(ownerId: string, now = new Date()) {
    return this.transaction(ownerId, async (client) => {
      await this.reconcile(client, ownerId);
      const policy = await effectivePolicy(client, ownerId);
      const metrics = [];
      for (const metric of [
        'generation',
        'assistant-response',
        'image',
        'edit',
        'concurrency',
        'storage',
      ] as const) {
        const limit = policy.effective[metric] ?? null;
        const window = policyWindow(limit, now);
        const totals = await client.query(
          `SELECT count(*) FILTER(WHERE status='completed')::int AS completed,
          count(*) FILTER(WHERE status='active')::int AS active FROM account_operations WHERE owner_id=$1 AND metric=$2
          AND admitted_at >= $3 AND ($4::timestamptz IS NULL OR admitted_at<$4)`,
          [ownerId, metric === 'concurrency' ? 'generation' : metric, window.start, window.end],
        );
        metrics.push({ metric, limit, ...window, ...totals.rows[0] });
      }
      return { ...policy, metrics };
    });
  }
}
