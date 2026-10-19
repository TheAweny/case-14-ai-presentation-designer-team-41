import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRunRepository } from './postgres-run-repository.js';
import { GenerationBuildStore, type BuildLease } from './generation-build-store.js';
import { PostgresProviderLedger } from './provider-ledger.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('generation ownership and accounting on actual PostgreSQL', () => {
  const schema = `generation_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let store: GenerationBuildStore;
  let repository: PostgresRunRepository;
  beforeAll(async () => {
    await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public');
    await admin.query(`CREATE SCHEMA ${schema}`);
    if (!databaseUrl) throw new Error('Missing test database');
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    pool = new Pool({ connectionString: url.toString() });
    repository = new PostgresRunRepository({ connectionString: url.toString() });
    await repository.migrate();
    store = new GenerationBuildStore(pool);
  });
  afterAll(async () => {
    await repository?.close();
    await pool?.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  async function leased(): Promise<BuildLease> {
    const build = await store.create('owner', randomUUID(), 'hash', { facts: '18 %' });
    const lease = await store.claim(build.id, 'owner');
    if (!lease) throw new Error('claim failed');
    return lease;
  }

  it('duplicate starts atomically create exactly one build and three stable run ids', async () => {
    const key = randomUUID();
    const builds = await Promise.all(
      Array.from({ length: 6 }, () => store.create('owner', key, 'same-hash', { facts: '18 %' })),
    );
    expect(new Set(builds.map((build) => build.id)).size).toBe(1);
    expect(
      new Set(builds.flatMap((build) => build.variants.map((entry) => entry.runId))).size,
    ).toBe(3);
    await expect(store.create('owner', key, 'changed-hash', {})).rejects.toThrow(
      'другое содержание',
    );
  });

  it('concurrent resume has one executor, preserves ownership, and fences stale callbacks', async () => {
    const build = await store.create('owner', randomUUID(), 'hash', {});
    expect(await store.get(build.id, 'stranger')).toBeNull();
    expect(await store.claim(build.id, 'stranger')).toBeNull();
    const contenders = await Promise.all(
      Array.from({ length: 5 }, () => store.claim(build.id, 'owner')),
    );
    const leases = contenders.filter((entry): entry is BuildLease => entry !== null);
    expect(leases).toHaveLength(1);
    const stale = leases[0];
    if (!stale) throw new Error('Missing lease');
    await pool.query(
      "UPDATE generation_builds SET lease_until=now()-interval '1 second' WHERE id=$1",
      [build.id],
    );
    const replacement = await store.claim(build.id, 'owner');
    expect(replacement?.fence).not.toBe(stale.fence);
    await expect(store.assert(stale)).rejects.toThrow();
    await expect(store.renew(stale)).rejects.toThrow();
    await expect(store.finish(stale, 'done')).rejects.toThrow();
    if (!replacement) throw new Error('Missing replacement lease');
    await expect(store.assert(replacement)).resolves.toBeUndefined();
  });

  it('an explicit Stop cannot auto-resume; explicit resume can reclaim it', async () => {
    const lease = await leased();
    await store.stop(lease.build.id, 'stranger');
    await store.assert(lease);
    await store.stop(lease.build.id, 'owner');
    await expect(store.assert(lease)).rejects.toThrow();
    expect(await store.claim(lease.build.id, 'owner')).toBeNull();
    expect(await store.claim(lease.build.id, 'owner', true)).not.toBeNull();
  });

  it('does not publish done when file persistence fails; publication and DB status recover together', async () => {
    const lease = await leased();
    const runId = lease.build.variants[0]?.runId;
    if (!runId) throw new Error('Missing variant');
    await repository.transition(runId, 'running');
    const done = {
      schemaVersion: 1 as const,
      runId,
      seq: 0,
      at: new Date().toISOString(),
      type: 'done' as const,
      totalMs: 1,
      manifestPath: 'manifest.json',
    };
    await expect(
      store.publish(lease, done, async () => {
        throw new Error('disk failure');
      }),
    ).rejects.toThrow('disk failure');
    expect((await repository.get(runId))?.state).toBe('running');
    expect(await repository.events(runId)).toHaveLength(0);
    await store.publish(lease, done, async () => undefined);
    expect((await repository.get(runId))?.state).toBe('done');
    expect(await repository.events(runId)).toHaveLength(1);
    await expect(store.publish(lease, { ...done, runId: 'run-foreign' })).rejects.toThrow();
  });

  const intent = {
    taskKey: 'task-hash',
    modelId: 'fake',
    kind: 'text',
    reservedTokens: 100,
    estimatedCost: null,
    pricingVersion: null,
    currency: null,
  };
  it('atomic in-flight reservations prevent overspending from concurrent HTTP sends', async () => {
    const lease = await leased();
    const ledger = new PostgresProviderLedger(pool, 'owner', lease, {
      requests: 1,
      tokens: 100,
      cost: null,
    });
    const attempts = await Promise.allSettled([ledger.begin(intent), ledger.begin(intent)]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(await ledger.summary()).toMatchObject({
      requests: 1,
      unknown_usage: 1,
      unknown_cost: 1,
    });
  });

  it('resume retains costs, unknown outcomes and pending reservations after process loss', async () => {
    const lease = await leased();
    const ledger = new PostgresProviderLedger(pool, 'owner', lease, {
      requests: 3,
      tokens: 250,
      cost: null,
    });
    const id = await ledger.begin({
      ...intent,
      estimatedCost: 0.1,
      pricingVersion: 'fixture-v1',
      currency: 'USD',
    });
    await ledger.end(id, {
      status: 'response-received',
      httpStatus: 200,
      inputTokens: 5,
      outputTokens: 5,
      actualCost: 0.05,
    });
    await ledger.begin(intent); // response never reached the process; conservatively remains unknown.
    await store.finish(lease, 'failed');
    const resumed = await store.claim(lease.build.id, 'owner');
    if (!resumed) throw new Error('Missing resumed lease');
    const cumulative = new PostgresProviderLedger(pool, 'owner', resumed, {
      requests: 3,
      tokens: 250,
      cost: null,
    });
    expect(await cumulative.summary()).toMatchObject({
      requests: 2,
      unknown_usage: 1,
      unknown_cost: 1,
      known_cost: '0.05',
    });
    await cumulative.begin(intent);
    await expect(cumulative.begin(intent)).rejects.toThrow();
    await expect(ledger.begin(intent)).rejects.toThrow('истекло');
  });

  it('rejects unknown prices under an explicit cost budget', async () => {
    const lease = await leased();
    const ledger = new PostgresProviderLedger(pool, 'owner', lease, {
      requests: 10,
      tokens: 1000,
      cost: 1,
    });
    await expect(ledger.begin(intent)).rejects.toThrow('неизвестна');
    await ledger.begin({
      ...intent,
      estimatedCost: 0.8,
      pricingVersion: 'fixture-v1',
      currency: 'USD',
    });
    await expect(
      ledger.begin({
        ...intent,
        estimatedCost: 0.3,
        pricingVersion: 'fixture-v1',
        currency: 'USD',
      }),
    ).rejects.toThrow('бюджет');
  });
});
