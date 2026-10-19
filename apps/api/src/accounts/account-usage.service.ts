import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AccountLimitError, AccountUsageStore, effectivePolicy } from '@lct/run-store';
import { Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readdir, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

class AccountPolicyHttpException extends HttpException {
  readonly code = 'account-limit';
  constructor(error: AccountLimitError) {
    super(
      { code: error.code, metric: error.metric, resetsAt: error.resetsAt, message: error.message },
      403,
    );
  }
}

export async function directoryBytes(path: string): Promise<number> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info || info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  return (
    await Promise.all((await readdir(path)).map((name) => directoryBytes(join(path, name))))
  ).reduce((a, b) => a + b, 0);
}
/** Shared admission and storage hooks. Existing editor autosave remains unchanged. */
@Injectable()
export class AccountUsageService implements OnApplicationShutdown {
  private readonly editContext = new AsyncLocalStorage<{
    ownerId: string;
    operationId: string;
    worker: string | null;
    client: PoolClient;
    check: () => Promise<void>;
  }>();
  private readonly reservationContext = new AsyncLocalStorage<{
    ownerId: string;
    limit: number;
    lock: PoolClient;
  }>();
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  readonly store = new AccountUsageStore(this.pool);
  readonly root = resolve(process.env.RUNS_DIR ?? 'runs');
  async onApplicationShutdown() {
    await this.pool.end();
  }
  async translate<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AccountLimitError) throw new AccountPolicyHttpException(error);
      throw error;
    }
  }
  /** Existing file bytes and JSON revisions, charged to their owner; shared assets charged once
   * to the uploader, never to every viewer. Media aliases count unique physical storage keys.
   */
  async storageBytes(ownerId: string, db: Pick<PoolClient, 'query'> = this.pool): Promise<number> {
    const files = await db.query('SELECT storage_path FROM stored_files WHERE owner_id=$1', [
      ownerId,
    ]);
    let total = 0;
    for (const file of files.rows) total += await directoryBytes(join(file.storage_path, '..'));
    for (const name of await readdir(this.root).catch(() => [])) {
      if (!/^run-[a-f0-9-]{36}$/i.test(name)) continue;
      const directory = join(this.root, name);
      const metadata = await readFile(join(directory, 'metadata.json'), 'utf8')
        .then((raw) => JSON.parse(raw))
        .catch(() => ({}));
      if (metadata.ownerId === ownerId)
        for (const entry of await readdir(directory)) {
          // Fence-specific execution files are temporary; published artifacts count once.
          if (entry !== 'executions') total += await directoryBytes(join(directory, entry));
        }
    }
    const json = await db.query(
      `SELECT COALESCE(sum(n),0) AS bytes FROM (
      SELECT pg_column_size(slides)+pg_column_size(media) AS n FROM editor_snapshots WHERE account_id=$1
      UNION ALL SELECT pg_column_size(slides)+pg_column_size(media) FROM editor_conflicts WHERE account_id=$1
      UNION ALL SELECT pg_column_size(outcome) FROM editor_idempotency WHERE account_id=$1) sizes`,
      [ownerId],
    );
    total += Number(json.rows[0].bytes);
    const media = await db.query(
      'SELECT DISTINCT storage_key FROM editor_media WHERE account_id=$1',
      [ownerId],
    );
    for (const row of media.rows)
      total += await directoryBytes(join(this.root, 'editor-media', row.storage_key));
    return total;
  }
  async view(ownerId: string) {
    const [view, bytes] = await Promise.all([this.store.view(ownerId), this.storageBytes(ownerId)]);
    return { ...view, storageBytes: bytes };
  }
  async mediaReserve(ownerId: string, deckId: string, bytes: Buffer) {
    const existing = await this.pool.query(
      'SELECT 1 FROM editor_media WHERE account_id=$1 AND deck_id=$2 AND sha256=$3 LIMIT 1',
      [ownerId, deckId, createHash('sha256').update(bytes).digest('hex')],
    );
    return existing.rowCount ? 0 : bytes.length;
  }
  async snapshotReserve(ownerId: string, deckId: string, key: string, value: unknown) {
    const db = this.editContext.getStore()?.client ?? this.pool;
    const existing = await db.query(
      'SELECT 1 FROM editor_idempotency WHERE account_id=$1 AND deck_id=$2 AND idempotency_key=$3',
      [ownerId, deckId, key],
    );
    return existing.rowCount ? 0 : Buffer.byteLength(JSON.stringify(value)) * 8 + 65536;
  }
  /** A live PostgreSQL session guard spans admission, storage waiting and snapshot commit. */
  async edit<T>(ownerId: string, operationId: string, work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const key = `account-operation:${ownerId}:${operationId}`;
    let broken = false;
    let worker: string | null = null;
    const lost = () => {
      broken = true;
    };
    client.on('error', lost);
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
      worker = await this.translate(() =>
        this.store.admit(ownerId, operationId, 'edit', new Date(), client),
      );
      return await this.editContext.run(
        {
          ownerId,
          operationId,
          worker,
          client,
          check: async () => {
            if (broken)
              throw new ConflictException('Сохранение прервано. Повторите отправку редакции.');
            await client.query('SELECT 1');
          },
        },
        work,
      );
    } finally {
      // Success is already counted by the snapshot transaction. Release only an unfinished edit.
      if (worker && !broken)
        await this.store.finish(ownerId, operationId, false, worker, client).catch(() => {
          broken = true;
        });
      if (!broken)
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]).catch(() => {
          broken = true;
        });
      client.off('error', lost);
      client.release(broken);
    }
  }
  /** Fence the operation row inside the snapshot transaction, before its success trigger runs. */
  async verifyEditOperation(ownerId: string, operationId: string, db: PoolClient) {
    const edit = this.editContext.getStore();
    if (!edit || edit.ownerId !== ownerId || edit.operationId !== operationId)
      throw new ConflictException('Нет допуска к сохранению редакции.');
    await edit.check();
    if (!edit.worker) return;
    const owned = await db.query(
      "SELECT 1 FROM account_operations WHERE owner_id=$1 AND operation_id=$2 AND worker_id=$3 AND status='active' FOR UPDATE",
      [ownerId, operationId, edit.worker],
    );
    if (!owned.rowCount)
      throw new ConflictException('Допуск к сохранению истёк. Повторите отправку редакции.');
  }
  /** Called inside the editor transaction, before its revision and idempotency outcome commit. */
  async verifySnapshotStorage(ownerId: string, db: PoolClient) {
    const context = this.reservationContext.getStore();
    if (!context) return;
    if (context.ownerId !== ownerId) throw new Error('Storage reservation ownership mismatch');
    await context.lock.query('SELECT 1');
    if ((await this.storageBytes(ownerId, db)) > context.limit)
      throw new AccountLimitError('storage', null);
  }
  /** Run metadata also occupies space. Restore its previous bytes if publication is refused. */
  async writeFiles(ownerId: string, directory: string, files: Record<string, string>) {
    let previous: Record<string, Buffer | null> | null = null;
    const write = async () => {
      previous = {};
      for (const name of Object.keys(files))
        previous[name] = await readFile(join(directory, name)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          },
        );
      await mkdir(directory, { recursive: true });
      for (const [name, contents] of Object.entries(files))
        await writeFile(join(directory, name), contents);
    };
    await this.write(
      ownerId,
      Object.values(files).reduce((total, value) => total + Buffer.byteLength(value), 0),
      write,
      async () => {
        if (!previous) return;
        for (const [name, contents] of Object.entries(previous)) {
          if (contents === null) await rm(join(directory, name), { force: true });
          else await writeFile(join(directory, name), contents);
        }
      },
    );
  }
  /** Durable reserve precedes writing. Hold account storage lock across write and actual-size
   * reconciliation; an over-limit staged directory is removed before its publication callback.
   */
  async write<T>(
    ownerId: string,
    reservedBytes: number,
    work: () => Promise<T>,
    rollback?: () => Promise<void>,
  ): Promise<T> {
    if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 0)
      throw new BadRequestException('Invalid storage reservation');
    const edit = this.editContext.getStore();
    if (edit && edit.ownerId !== ownerId) throw new Error('Edit reservation ownership mismatch');
    const client = edit?.client ?? (await this.pool.connect());
    const lock = `account-storage:${ownerId}`;
    const reservation = randomUUID();
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
      const policy = (await effectivePolicy(client, ownerId)).effective.storage;
      if (!policy) return await work();
      // An orphan is reclaimed only while holding its account lock: no other writer can be alive.
      await client.query('DELETE FROM account_storage_reservations WHERE owner_id=$1', [ownerId]);
      const before = await this.storageBytes(ownerId, client);
      if (before + reservedBytes > policy.limit) throw new AccountLimitError('storage', null);
      // A renderer's size is unknown beforehand. Reserve the remaining allowance and serialize
      // its staging write; actual excess is removed before the export id is returned.
      const allocation =
        reservedBytes === 0 && rollback ? Math.max(0, policy.limit - before) : reservedBytes;
      await client.query(
        "INSERT INTO account_storage_reservations(id,owner_id,bytes,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [reservation, ownerId, allocation],
      );
      const result = await this.reservationContext.run(
        { ownerId, limit: policy.limit, lock: client },
        work,
      );
      const actual = await this.storageBytes(ownerId, client);
      if (actual > policy.limit && rollback) {
        throw new AccountLimitError('storage', null);
      }
      return result;
    } catch (error) {
      await rollback?.();
      if (error instanceof AccountLimitError) throw new AccountPolicyHttpException(error);
      throw error;
    } finally {
      await client
        .query('DELETE FROM account_storage_reservations WHERE id=$1', [reservation])
        .catch(() => undefined);
      await client
        .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock])
        .catch(() => undefined);
      if (!edit) client.release();
    }
  }
  removeStaging(path: string) {
    return rm(path, { recursive: true, force: true });
  }
}
