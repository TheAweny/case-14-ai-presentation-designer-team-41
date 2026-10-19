import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountUsageStore, policyWindow } from './account-usage.js';
import { PostgresRunRepository } from './postgres-run-repository.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('optional enterprise policy on PostgreSQL', () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = `policy_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let replica: Pool;
  let repository: PostgresRunRepository;
  let store: AccountUsageStore;
  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Missing DB');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    pool = new Pool({ connectionString: url.toString() });
    replica = new Pool({ connectionString: url.toString() });
    repository = new PostgresRunRepository({ connectionString: url.toString() });
    await repository.migrate();
    store = new AccountUsageStore(pool);
    await pool.query(
      "INSERT INTO app_users(id,email,name,password_hash,role) VALUES('policy-admin','policy-admin@example.test','Admin','hash','admin')",
    );
  });
  afterAll(async () => {
    await repository?.close();
    await pool?.end();
    await replica?.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  async function user() {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO app_users(id,email,name,password_hash) VALUES($1,$2,'User','hash')",
      [id, `${id}@example.test`],
    );
    return id;
  }
  const rule = (limit: number) => ({ limit, period: 'lifetime' as const, timezone: 'UTC' });
  it('leaves existing and new accounts unlimited, without tariff setup', async () => {
    const id = await user();
    for (let i = 0; i < 3; i++) {
      const op = randomUUID();
      await store.admit(id, op, 'generation');
      await store.finish(id, op, true);
    }
    const view = await store.view(id);
    expect(view.effective).toEqual({});
    expect(view.metrics.find((row) => row.metric === 'generation')?.completed).toBe(3);
    expect((await pool.query('SELECT count(*)::int AS n FROM account_policies')).rows[0].n).toBe(0);
  });
  it('reserves a single remaining result atomically across replicas, not per model key', async () => {
    const id = await user();
    await store.setPolicy(id, { generation: rule(1) }, 'policy-admin');
    const results = await Promise.allSettled([
      store.admit(id, 'personal-' + id, 'generation'),
      new AccountUsageStore(replica).admit(id, 'shared-' + id, 'generation'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
  it('counts duplicate success once, releases failure, and resume uses the same id', async () => {
    const id = await user();
    const op = randomUUID();
    await store.setPolicy(id, { generation: rule(1) }, 'policy-admin');
    await store.admit(id, op, 'generation');
    await store.admit(id, op, 'generation');
    expect((await store.view(id)).metrics[0]).toMatchObject({ completed: 0, active: 1 });
    await store.finish(id, op, false);
    await store.admit(id, op, 'generation');
    await store.finish(id, op, true);
    await store.finish(id, op, true);
    expect((await store.view(id)).metrics[0]).toMatchObject({ completed: 1, active: 0 });
    await store.admit(id, op, 'generation');
    await expect(store.admit(id, randomUUID(), 'generation')).rejects.toMatchObject({
      code: 'account-limit',
    });
  });
  it('keeps statistics when disabling/re-enabling or lowering a policy; already admitted work may finish', async () => {
    const id = await user();
    const op = randomUUID();
    await store.admit(id, op, 'generation');
    await store.setPolicy(id, { generation: rule(0) }, 'policy-admin');
    await store.finish(id, op, true);
    await expect(store.admit(id, randomUUID(), 'generation')).rejects.toMatchObject({
      code: 'account-limit',
    });
    await store.setPolicy(id, { generation: null }, 'policy-admin');
    const second = randomUUID();
    await store.admit(id, second, 'generation');
    await store.finish(id, second, true);
    await store.setPolicy(id, { generation: rule(2) }, 'policy-admin');
    await expect(store.admit(id, randomUUID(), 'generation')).rejects.toMatchObject({
      code: 'account-limit',
    });
    expect((await store.view(id)).metrics[0].completed).toBe(2);
  });
  it('counts categories independently; concurrency counts a build once', async () => {
    const id = await user();
    const op = randomUUID();
    await store.setPolicy(
      id,
      { concurrency: rule(1), 'assistant-response': rule(1) },
      'policy-admin',
    );
    await store.admit(id, op, 'generation');
    await store.admit(id, op, 'generation');
    await expect(store.admit(id, randomUUID(), 'generation')).rejects.toMatchObject({
      metric: 'concurrency',
    });
    const chat = randomUUID();
    await store.admit(id, chat, 'assistant-response');
    await store.finish(id, chat, true);
    await store.admit(id, randomUUID(), 'image');
    await store.finish(id, op, false);
    await store.admit(id, randomUUID(), 'generation');
  });
  it('moves a released operation to its resume admission period, without counting old success twice', async () => {
    const id = await user();
    const op = randomUUID();
    const day = { limit: 1, period: 'day' as const, timezone: 'Europe/Moscow' };
    await store.setPolicy(id, { generation: day }, 'policy-admin');
    await store.admit(id, op, 'generation', new Date('2026-10-19T12:00:00Z'));
    await store.finish(id, op, false);
    await store.admit(id, op, 'generation', new Date('2026-10-20T12:00:00Z'));
    await store.finish(id, op, true);
    expect((await store.view(id, new Date('2026-10-19T12:00:00Z'))).metrics[0].completed).toBe(0);
    expect((await store.view(id, new Date('2026-10-20T12:00:00Z'))).metrics[0].completed).toBe(1);
  });
  it('rejects policy mutation by a user, even for their own account', async () => {
    const id = await user();
    await expect(store.setPolicy(id, { generation: null }, id)).rejects.toThrow('администратор');
  });
  it('keeps a live chat reservation after heartbeat expiry and frees it only after execution ends', async () => {
    const id = await user();
    const chat = randomUUID();
    const op = `chat:${chat}:${randomUUID()}`;
    await store.setPolicy(id, { 'assistant-response': rule(1) }, 'policy-admin');
    await store.admit(id, op, 'assistant-response');
    const lock = await replica.connect();
    try {
      await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`chat:${chat}`]);
      await pool.query(
        "UPDATE account_operations SET lease_until=now()-interval '1 minute' WHERE operation_id=$1",
        [op],
      );
      expect(
        (await store.view(id)).metrics.find((row) => row.metric === 'assistant-response'),
      ).toMatchObject({ active: 1, completed: 0 });
      await expect(store.admit(id, randomUUID(), 'assistant-response')).rejects.toMatchObject({
        code: 'account-limit',
      });
      await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`chat:${chat}`]);
      expect(
        (await store.view(id)).metrics.find((row) => row.metric === 'assistant-response'),
      ).toMatchObject({ active: 0, completed: 0 });
      await expect(store.admit(id, randomUUID(), 'assistant-response')).resolves.toBeTypeOf(
        'string',
      );
    } finally {
      lock.release(true);
    }
  });
  it('distinguishes inherited, explicitly disabled and zero limits and audits every change', async () => {
    const id = await user();
    await store.setPolicy('default', { generation: rule(0) }, 'policy-admin');
    expect((await store.view(id)).effective.generation?.limit).toBe(0);
    await store.setPolicy(id, { generation: null }, 'policy-admin');
    await store.admit(id, randomUUID(), 'generation');
    expect((await store.view(id)).effective.generation).toBeNull();
    await store.setPolicy(id, {}, 'policy-admin');
    await expect(store.admit(id, randomUUID(), 'generation')).rejects.toMatchObject({
      code: 'account-limit',
    });
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM account_policy_audit WHERE scope=$1', [id]))
        .rows[0].n,
    ).toBe(2);
    await store.setPolicy('default', {}, 'policy-admin');
  });
});
describe('explicit timezone windows', () => {
  it('uses a 23-hour day during DST and UTC timestamps', () => {
    const window = policyWindow(
      { limit: 1, period: 'day', timezone: 'America/New_York' },
      new Date('2026-03-08T15:00:00Z'),
    );
    expect(window).toEqual({ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' });
  });
  it('uses the local month and does not reset lifetime counters', () => {
    expect(
      policyWindow(
        { limit: 1, period: 'month', timezone: 'Europe/Moscow' },
        new Date('2026-10-31T22:00:00Z'),
      ),
    ).toEqual({ start: '2026-10-31T21:00:00.000Z', end: '2026-11-30T21:00:00.000Z' });
  });
});
