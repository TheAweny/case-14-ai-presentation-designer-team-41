import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { AccountUsageStore, PostgresRunRepository } from '@lct/run-store';
import { SessionsService } from './sessions.service.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { AccountGuard } from '../accounts/account.guard.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { PostgresEditorSnapshotStore } from '../editor/snapshot-store.js';
import { editorSnapshotSaveRequestSchema } from '@lct/contracts';
import { EditorService } from '../editor/editor.service.js';
import type { GenerationService } from '../generation/generation.service.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('enterprise auth and storage on PostgreSQL', () => {
  const schema = `access_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let repository: PostgresRunRepository;
  let sessions: SessionsService;
  let accounts: AccountsService;
  let usage: AccountUsageService;
  let root: string;
  beforeAll(async () => {
    if (!databaseUrl) throw new Error('Missing DB');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    repository = new PostgresRunRepository({ connectionString: url.toString() });
    await repository.migrate();
    pool = new Pool({ connectionString: url.toString() });
    root = await mkdtemp(join(tmpdir(), 'lct-access-'));
    sessions = new SessionsService();
    await sessions.pool.end();
    Object.assign(sessions, { pool });
    accounts = new AccountsService();
    Object.assign(accounts, { pool });
    usage = new AccountUsageService();
    await usage.pool.end();
    Object.assign(usage, {
      pool,
      root,
      store: new (await import('@lct/run-store')).AccountUsageStore(pool),
    });
    await pool.query(
      "INSERT INTO app_users(id,email,name,password_hash,role) VALUES('access-admin','access-admin@example.test','Admin',crypt('fixture-password',gen_salt('bf')),'admin')",
    );
  });
  afterAll(async () => {
    await repository?.close();
    await pool?.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function user() {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO app_users(id,email,name,password_hash) VALUES($1,$2,'User',crypt('fixture-password',gen_salt('bf')))",
      [id, `${id}@example.test`],
    );
    return id;
  }
  function snapshotRequest(expectedRevision = 0) {
    return editorSnapshotSaveRequestSchema.parse({
      schemaVersion: 1,
      expectedRevision,
      idempotencyKey: randomUUID(),
      base: 'fixture',
      media: [],
      slides: [
        {
          schemaVersion: 1,
          slideId: 's1',
          variant: 'balanced',
          index: 0,
          patternId: 'synthetic',
          slideCx: 100,
          slideCy: 100,
          elements: [],
        },
      ],
    });
  }
  it.each(['lock', 'scan'])(
    'retains the edit admission during a long storage %s and counts the snapshot once',
    async (phase) => {
      const id = await user();
      const deck = `run-${randomUUID()}`;
      const input = snapshotRequest();
      const operation = `edit:${id}:${deck}:${input.idempotencyKey}`;
      const account = await accounts.find(id);
      if (!account) throw new Error('Missing fixture account');
      const editor = new EditorService(
        {
          pool,
          root,
          directory: (value: string) => join(root, value),
          library: { visible: async () => true, read: async () => ({ variant: 'balanced' }) },
        } as unknown as GenerationService,
        usage,
      );
      await usage.store.setPolicy(
        id,
        {
          edit: { limit: 1, period: 'lifetime', timezone: 'UTC' },
          storage: { limit: 1_000_000, period: 'lifetime', timezone: 'UTC' },
        },
        'access-admin',
      );
      const storage = await pool.connect();
      if (phase === 'lock')
        await storage.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
          `account-storage:${id}`,
        ]);
      let releaseScan = () => undefined as void;
      const waitScan = new Promise<void>((resolve) => {
        releaseScan = resolve;
      });
      const originalBytes = usage.storageBytes.bind(usage);
      const scan =
        phase === 'scan'
          ? vi.spyOn(usage, 'storageBytes').mockImplementationOnce(async (...args) => {
              await waitScan;
              return originalBytes(...args);
            })
          : null;
      const pending = editor.save(deck, input, account);
      void pending.catch(() => undefined);
      try {
        await vi.waitFor(async () =>
          expect(
            (
              await pool.query('SELECT status FROM account_operations WHERE operation_id=$1', [
                operation,
              ])
            ).rows[0]?.status,
          ).toBe('active'),
        );
        if (scan) await vi.waitFor(() => expect(scan).toHaveBeenCalled());
        // Simulate waiting beyond the lease; do not spend a minute sleeping in a regression.
        await pool.query(
          "UPDATE account_operations SET lease_until=now()-interval '1 minute' WHERE operation_id=$1",
          [operation],
        );
        expect(
          (await usage.store.view(id)).metrics.find((row) => row.metric === 'edit'),
        ).toMatchObject({ active: 1, completed: 0 });
        await expect(
          usage.store.admit(id, `edit:${id}:${deck}:${randomUUID()}`, 'edit'),
        ).rejects.toMatchObject({ code: 'account-limit' });
        releaseScan();
        if (phase === 'lock')
          await storage.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            `account-storage:${id}`,
          ]);
        const result = await pending;
        expect(result.kind).toBe('saved');
        expect(
          (await usage.store.view(id)).metrics.find((row) => row.metric === 'edit'),
        ).toMatchObject({ active: 0, completed: 1 });
        expect(await editor.save(deck, input, account)).toEqual(result);
        await expect(editor.save(deck, snapshotRequest(1), account)).rejects.toMatchObject({
          status: 403,
        });
      } finally {
        releaseScan();
        if (phase === 'lock')
          await storage.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            `account-storage:${id}`,
          ]);
        storage.release();
        await pending.catch(() => undefined);
        scan?.mockRestore();
      }
    },
  );
  it('reconciles an edit whose guard connection died and retries with a one-connection usage pool', async () => {
    const id = await user();
    const deck = `run-${randomUUID()}`;
    const input = snapshotRequest();
    const operation = `edit:${id}:${deck}:${input.idempotencyKey}`;
    const account = await accounts.find(id);
    if (!account) throw new Error('Missing account');
    const one = new Pool({
      connectionString: pool.options.connectionString,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    const replica = new AccountUsageService();
    await replica.pool.end();
    Object.assign(replica, { pool: one, root, store: new AccountUsageStore(one) });
    const editor = new EditorService(
      {
        pool,
        root,
        directory: (value: string) => join(root, value),
        library: { visible: async () => true, read: async () => ({ variant: 'balanced' }) },
      } as unknown as GenerationService,
      replica,
    );
    await usage.store.setPolicy(
      id,
      {
        edit: { limit: 1, period: 'lifetime', timezone: 'UTC' },
        storage: { limit: 1_000_000, period: 'lifetime', timezone: 'UTC' },
      },
      'access-admin',
    );
    const connection = await one.connect();
    const pid = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    connection.release();
    const storage = await pool.connect();
    await storage.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
      `account-storage:${id}`,
    ]);
    const pending = editor.save(deck, input, account);
    void pending.catch(() => undefined);
    try {
      await vi.waitFor(async () =>
        expect(
          (
            await pool.query('SELECT status FROM account_operations WHERE operation_id=$1', [
              operation,
            ])
          ).rows[0]?.status,
        ).toBe('active'),
      );
      await pool.query(
        "UPDATE account_operations SET lease_until=now()-interval '1 minute' WHERE operation_id=$1",
        [operation],
      );
      await pool.query('SELECT pg_terminate_backend($1)', [pid]);
      await expect(pending).rejects.toThrow();
      expect(
        (await usage.store.view(id)).metrics.find((row) => row.metric === 'edit'),
      ).toMatchObject({ completed: 0, active: 0 });
      await storage.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        `account-storage:${id}`,
      ]);
      expect((await editor.save(deck, input, account)).kind).toBe('saved');
      expect(
        (await usage.store.view(id)).metrics.find((row) => row.metric === 'edit'),
      ).toMatchObject({ completed: 1, active: 0 });
      expect(
        (
          await pool.query('SELECT count(*)::int AS n FROM editor_snapshots WHERE account_id=$1', [
            id,
          ])
        ).rows[0].n,
      ).toBe(1);
    } finally {
      await storage.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        `account-storage:${id}`,
      ]);
      storage.release();
      await pending.catch(() => undefined);
      await one.end();
    }
  });
  it('rejects a fenced edit before changing the last snapshot or counting another worker success', async () => {
    const id = await user();
    const deck = `run-${randomUUID()}`;
    const account = await accounts.find(id);
    if (!account) throw new Error('Missing account');
    const editor = new EditorService(
      {
        pool,
        root,
        directory: (value: string) => join(root, value),
        library: { visible: async () => true, read: async () => ({ variant: 'balanced' }) },
      } as unknown as GenerationService,
      usage,
    );
    await editor.save(deck, snapshotRequest(), account);
    const input = snapshotRequest(1);
    const operation = `edit:${id}:${deck}:${input.idempotencyKey}`;
    const nextWorker = randomUUID();
    const reserve = usage.snapshotReserve.bind(usage);
    const inject = vi.spyOn(usage, 'snapshotReserve').mockImplementationOnce(async (...args) => {
      await pool.query('UPDATE account_operations SET worker_id=$2 WHERE operation_id=$1', [
        operation,
        nextWorker,
      ]);
      return reserve(...args);
    });
    try {
      await expect(editor.save(deck, input, account)).rejects.toMatchObject({ status: 409 });
      expect((await editor.load(deck, account)).snapshot?.revision).toBe(1);
      expect(
        (
          await pool.query(
            'SELECT 1 FROM editor_idempotency WHERE account_id=$1 AND idempotency_key=$2',
            [id, input.idempotencyKey],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (await usage.store.view(id)).metrics.find((row) => row.metric === 'edit'),
      ).toMatchObject({ completed: 1, active: 1 });
    } finally {
      inject.mockRestore();
      await usage.store.finish(id, operation, false, nextWorker);
    }
  });
  it('revokes a copied token at logout, while keeping another session valid', async () => {
    const id = await user();
    const first = await sessions.create(id, 'fixture-password');
    const second = await sessions.create(id, 'fixture-password');
    expect(await sessions.owner(first.token)).toBe(id);
    await sessions.revoke(first.token);
    expect(await sessions.owner(first.token)).toBeNull();
    expect(await sessions.owner(second.token)).toBe(id);
    const hashes = await pool.query('SELECT token_hash FROM account_sessions WHERE account_id=$1', [
      id,
    ]);
    expect(hashes.rows.every((row) => row.token_hash !== second.token)).toBe(true);
  });
  it.each(['password', 'disable', 'admin-revoke'])(
    'revokes all copied sessions on %s',
    async (action) => {
      const id = await user();
      const first = await sessions.create(id, 'fixture-password');
      const second = await sessions.create(id, 'fixture-password');
      if (action === 'password')
        await accounts.changeOwnPassword(id, 'fixture-password', 'new-fixture-password');
      else if (action === 'disable') await accounts.update(id, { disabled: true }, 'access-admin');
      else await sessions.revokeAll(id, 'access-admin');
      expect(await sessions.owner(first.token)).toBeNull();
      expect(await sessions.owner(second.token)).toBeNull();
    },
  );
  it('refuses a password-reset race and a stale password even with a known account id', async () => {
    const id = await user();
    await accounts.update(id, { password: 'changed-password' }, 'access-admin');
    await expect(sessions.create(id, 'fixture-password')).rejects.toThrow();
    const audit = await pool.query(
      "SELECT * FROM account_policy_audit WHERE scope=$1 AND action='account-update'",
      [id],
    );
    expect(audit.rows[0].after_policy.passwordReset).toBe(true);
    expect(JSON.stringify(audit.rows)).not.toMatch(
      /changed-password|password_hash|fixture-password/,
    );
    await expect(sessions.revokeAll('access-admin', id)).rejects.toMatchObject({ status: 403 });
  });
  it('refuses forged headers, foreign sessions and a revoked session at the guard boundary', async () => {
    const id = await user();
    const other = await user();
    const session = await sessions.create(id, 'fixture-password');
    const guard = new AccountGuard(new Reflector(), accounts, sessions);
    const context = (owner: string, token?: string) =>
      ({
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-lct-user': owner, 'x-lct-session': token } }),
        }),
      }) as unknown as ExecutionContext;
    await expect(guard.canActivate(context(id, session.token))).resolves.toBe(true);
    await expect(guard.canActivate(context(other, session.token))).rejects.toThrow();
    await expect(guard.canActivate(context(id))).rejects.toThrow();
    await sessions.revoke(session.token);
    await expect(guard.canActivate(context(id, session.token))).rejects.toThrow();
  });
  it('applies atomic login throttling before password work', async () => {
    const email = `${randomUUID()}@example.test`;
    for (let i = 0; i < 20; i++) await sessions.rateLimit(email);
    await expect(sessions.rateLimit(email)).rejects.toMatchObject({ status: 429 });
  });
  it('serializes account storage reservations, includes existing files, and leaves the previous bytes intact', async () => {
    const id = await user();
    const dir = join(root, 'content', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'data.txt'), '12345');
    await pool.query(
      "INSERT INTO stored_files(id,kind,file_name,storage_path,size_bytes,sha256,owner_id) VALUES($1,'content','data.txt',$2,5,$3,$4)",
      [randomUUID(), join(dir, 'data.txt'), 'a'.repeat(64), id],
    );
    await usage.store.setPolicy(
      id,
      { storage: { limit: 10, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    let serial = 0;
    const write = () =>
      usage.write(id, 5, async () => {
        const n = ++serial;
        await writeFile(join(dir, `${n}.txt`), '12345');
        return n;
      });
    const results = await Promise.allSettled([write(), write()]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await readFile(join(dir, 'data.txt'), 'utf8')).toBe('12345');
    expect(await usage.storageBytes(id)).toBe(10);
    await usage.store.setPolicy(id, { storage: null }, 'access-admin');
    await write();
    expect(await usage.storageBytes(id)).toBe(15);
  });
  it('removes an oversized staged output before returning it and reclaims orphan reservations', async () => {
    const id = await user();
    await usage.store.setPolicy(
      id,
      { storage: { limit: 2, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    const run = `run-${randomUUID()}`;
    const dir = join(root, run);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'metadata.json'), JSON.stringify({ ownerId: id }));
    const before = await usage.storageBytes(id);
    await usage.store.setPolicy(
      id,
      { storage: { limit: before + 2, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    const path = join(dir, 'new.bin');
    await expect(
      usage.write(
        id,
        1,
        () => writeFile(path, 'too large'),
        () => rm(path, { force: true }),
      ),
    ).rejects.toThrow();
    expect(await readFile(path).catch(() => null)).toBeNull();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM account_storage_reservations WHERE owner_id=$1',
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('reserves run metadata before writing and preserves previous files when refused', async () => {
    const id = await user();
    const directory = join(root, `run-${randomUUID()}`);
    await usage.store.setPolicy(
      id,
      { storage: { limit: 0, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    await expect(
      usage.writeFiles(id, directory, { 'metadata.json': JSON.stringify({ ownerId: id }) }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await readFile(join(directory, 'metadata.json')).catch(() => null)).toBeNull();
    await usage.store.setPolicy(id, {}, 'access-admin');
    await usage.writeFiles(id, directory, {
      'metadata.json': JSON.stringify({ ownerId: id }),
      'request.json': 'original',
    });
    await usage.store.setPolicy(
      id,
      { storage: { limit: await usage.storageBytes(id), period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    await expect(
      usage.writeFiles(id, directory, { 'request.json': 'replacement' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await readFile(join(directory, 'request.json'), 'utf8')).toBe('original');
  });
  it('commits snapshot usage atomically and preserves the last revision on an actual-size refusal', async () => {
    const id = await user();
    const deck = `run-${randomUUID()}`;
    const snapshots = new PostgresEditorSnapshotStore(pool, join(root, 'editor-media'));
    const request = (expectedRevision: number) =>
      editorSnapshotSaveRequestSchema.parse({
        schemaVersion: 1,
        expectedRevision,
        idempotencyKey: randomUUID(),
        base: 'fixture',
        media: [],
        slides: [
          {
            schemaVersion: 1,
            slideId: 's1',
            variant: 'balanced',
            index: 0,
            patternId: 'synthetic',
            slideCx: 100,
            slideCy: 100,
            elements: [],
          },
        ],
      });
    const first = request(0);
    const firstOp = `edit:${id}:${deck}:${first.idempotencyKey}`;
    await usage.store.admit(id, firstOp, 'edit');
    await snapshots.save(id, deck, first);
    // No finish callback: the revision transaction must already have counted success.
    expect((await usage.store.view(id)).metrics.find((row) => row.metric === 'edit')).toMatchObject(
      { completed: 1, active: 0 },
    );
    const before = await usage.storageBytes(id);
    await usage.store.setPolicy(
      id,
      { storage: { limit: before + 1, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    const next = request(1);
    const op = `edit:${id}:${deck}:${next.idempotencyKey}`;
    const worker = await usage.store.admit(id, op, 'edit');
    // Deliberately underestimate the preflight reserve to exercise the commit-time safeguard.
    await expect(
      usage.write(id, 0, () =>
        snapshots.save(id, deck, next, (client) => usage.verifySnapshotStorage(id, client)),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect((await snapshots.load(id, deck))?.revision).toBe(1);
    expect(await snapshots.savedOutcome(id, deck, next.idempotencyKey)).toBeNull();
    expect(await usage.storageBytes(id)).toBe(before);
    await usage.store.finish(id, op, false, worker);
    expect((await usage.store.view(id)).metrics.find((row) => row.metric === 'edit')).toMatchObject(
      { completed: 1, active: 0 },
    );
    expect(await snapshots.savedOutcome(id, deck, first.idempotencyKey)).toMatchObject({
      kind: 'saved',
    });
  });
  it('counts media aliases once and completes a durable assistant message without a callback', async () => {
    const id = await user();
    const deck = `run-${randomUUID()}`;
    const snapshots = new PostgresEditorSnapshotStore(pool, join(root, 'editor-media'));
    const bytes = Buffer.from('fixture-media');
    await usage.write(id, bytes.length, () =>
      snapshots.putMedia(id, deck, 'upload/a.png', bytes, 'image/png'),
    );
    const before = await usage.storageBytes(id);
    expect(before).toBe(bytes.length);
    await usage.store.setPolicy(
      id,
      { storage: { limit: before, period: 'lifetime', timezone: 'UTC' } },
      'access-admin',
    );
    await usage.write(id, await usage.mediaReserve(id, deck, bytes), () =>
      snapshots.putMedia(id, deck, 'upload/b.png', bytes, 'image/png'),
    );
    expect(await usage.storageBytes(id)).toBe(before);
    const chat = randomUUID();
    const op = `chat:${chat}:${randomUUID()}`;
    const message = randomUUID();
    await pool.query("INSERT INTO chats(id,owner_id,title) VALUES($1,$2,'Fixture')", [chat, id]);
    const worker = await usage.store.admit(id, op, 'assistant-response');
    if (!worker) throw new Error('Missing worker');
    await usage.store.bindResult(id, op, worker, message);
    const save = () =>
      pool.query('UPDATE chats SET messages=$2::jsonb WHERE id=$1', [
        chat,
        JSON.stringify([{ id: message, role: 'assistant', status: 'done' }]),
      ]);
    await save();
    await save();
    expect(
      (await usage.store.view(id)).metrics.find((row) => row.metric === 'assistant-response'),
    ).toMatchObject({ completed: 1, active: 0 });
  });
});
