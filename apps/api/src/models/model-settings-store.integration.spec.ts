import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRunRepository } from '@lct/run-store';
import { PostgresModelSettingsStore } from './model-settings-store.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

/**
 * The model settings SQL against a real PostgreSQL: the memory store the other tests use cannot
 * catch a wrong cast or a column that is not there.
 */
describeWithPostgres('PostgresModelSettingsStore integration', () => {
  const schema = `model_settings_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let store: PostgresModelSettingsStore;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl ?? '');
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    const runs = new PostgresRunRepository({ connectionString: url.toString(), maxConnections: 1 });
    await runs.migrate();
    await runs.close();
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    store = new PostgresModelSettingsStore(pool);
    await pool.query(
      `INSERT INTO app_users (id, email, name, password_hash, role)
       VALUES ('ann', 'ann@example.test', 'Ann', 'x', 'user')`,
    );
  });

  afterAll(async () => {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('stores a model for a role, as a default and as an account’s own choice', async () => {
    const role = {
      role: 'speech',
      kind: 'model',
      connectionId: 'server',
      modelId: 'whisper-large-v3',
    } as const;
    await store.setRole(role, null);
    await store.setRole({ ...role, modelId: 'own-voice' }, 'ann');
    expect(await store.listRoles(null)).toEqual([role]);
    expect(await store.listRoles('ann')).toEqual([{ ...role, modelId: 'own-voice' }]);
    await store.clearRole('speech', 'ann');
    expect(await store.listRoles('ann')).toEqual([]);
  });

  it('keeps how a model thinks and the kinds set by hand', async () => {
    const baseUrl = 'https://hub.example.test/v1';
    await store.saveReasoning(baseUrl, 'm', { toggle: 'reasoning-effort', levels: true }, '1.3.0');
    await store.setManualKinds(baseUrl, 'm', ['text', 'vision']);
    expect(await store.getCapability(baseUrl, 'm')).toEqual({
      reasoning: { toggle: 'reasoning-effort', levels: true },
      manualKinds: ['text', 'vision'],
      probeVersion: '1.3.0',
    });
    await store.setManualKinds(baseUrl, 'm', null);
    expect((await store.listCapabilities(baseUrl)).get('m')?.manualKinds).toBeUndefined();
  });

  it('keeps the check of the server connection across restarts', async () => {
    const check = {
      ok: true as const,
      at: '2026-10-17T10:00:00.000Z',
      models: ['qwen38-27b-fp8', 'whisper'],
      details: { whisper: { kinds: ['speech' as const] } },
    };
    await store.setServerModels('https://vk.example.test/v1', ['qwen38-27b-fp8']);
    await store.setServerCheck('https://vk.example.test/v1', check);
    const restarted = new PostgresModelSettingsStore(pool);
    expect(await restarted.getServerCheck('https://vk.example.test/v1')).toEqual(check);
    expect(await restarted.getServerModels('https://vk.example.test/v1')).toEqual([
      'qwen38-27b-fp8',
    ]);
  });
});
