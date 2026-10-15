import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import type {
  SqliteClient,
  SqliteInArgs,
  SqliteInValue,
  SqliteResultSet,
  SqliteStatement,
  SqliteTransaction,
  SqliteTransactionMode,
  SqliteValue,
} from '@mastra/libsql';

function inputValue(value: SqliteInValue): SQLInputValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function outputValue(value: SQLOutputValue): SqliteValue {
  if (value instanceof Uint8Array) return Uint8Array.from(value).buffer;
  if (typeof value !== 'bigint') return value;
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new RangeError('SQLite integer exceeds the safe number range.');
  return number;
}

/** Mastra's small SQL client interface, backed by Node 22.13's built-in SQLite API. */
export class NodeSqliteClient implements SqliteClient {
  readonly protocol = 'file';
  private readonly database: DatabaseSync;
  private ended = false;
  private queue: Promise<void> = Promise.resolve();
  private activeTransaction: SqliteTransaction | null = null;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(
      'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;',
    );
  }

  get closed(): boolean {
    return this.ended;
  }

  private assertOpen(): void {
    if (this.ended) throw new Error('The SQLite client is closed.');
  }

  /** A transaction holds the connection until commit/rollback; outside calls queue behind it. */
  private async acquire(): Promise<() => void> {
    this.assertOpen();
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.assertOpen();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private executeNow(statement: string | SqliteStatement): SqliteResultSet {
    this.assertOpen();
    const { sql, args = [] } = typeof statement === 'string' ? { sql: statement } : statement;
    const before = this.database.prepare('SELECT total_changes() AS total').get()?.total;
    const prepared = this.database.prepare(sql);
    prepared.setReadBigInts(true);
    let raw: Record<string, SQLOutputValue>[];
    const bind = (values: SqliteInArgs) =>
      Array.isArray(values)
        ? values.map(inputValue)
        : Object.fromEntries(
            Object.entries(values).map(([name, value]) => [name, inputValue(value)]),
          );
    const bound = bind(args);
    // all() executes both reads and writes once. columns() is unavailable on Node 22.13.
    if (Array.isArray(bound)) raw = prepared.all(...bound);
    else {
      prepared.setAllowBareNamedParameters(true);
      raw = prepared.all(bound);
    }
    const rows = raw.map((row) =>
      Object.fromEntries(Object.entries(row).map(([name, value]) => [name, outputValue(value)])),
    );
    const metadata = this.database
      .prepare('SELECT total_changes() AS total, last_insert_rowid() AS lastId')
      .get();
    const rowsAffected = Number(metadata?.total ?? 0) - Number(before ?? 0);
    const columns = Object.keys(rows[0] ?? {});
    return {
      columns,
      columnTypes: columns.map(() => ''),
      rows,
      rowsAffected,
      ...(rowsAffected > 0 ? { lastInsertRowid: BigInt(metadata?.lastId as number | bigint) } : {}),
    };
  }

  async execute(statement: string | SqliteStatement): Promise<SqliteResultSet> {
    const release = await this.acquire();
    try {
      return this.executeNow(statement);
    } finally {
      release();
    }
  }

  async batch(
    statements: Array<string | SqliteStatement>,
    mode: SqliteTransactionMode = 'deferred',
  ): Promise<SqliteResultSet[]> {
    const transaction = await this.transaction(mode);
    try {
      const results: SqliteResultSet[] = [];
      for (const statement of statements) results.push(await transaction.execute(statement));
      await transaction.commit();
      return results;
    } finally {
      transaction.close();
    }
  }

  async transaction(mode: SqliteTransactionMode = 'write'): Promise<SqliteTransaction> {
    const release = await this.acquire();
    try {
      if (mode === 'read') this.database.exec('PRAGMA query_only=ON');
      this.database.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED');
    } catch (error) {
      if (mode === 'read') this.database.exec('PRAGMA query_only=OFF');
      release();
      throw error;
    }
    let closed = false;
    const finish = (sql: 'COMMIT' | 'ROLLBACK') => {
      this.assertOpen();
      if (closed) throw new Error('The SQLite transaction is closed.');
      this.database.exec(sql);
      closed = true;
      this.activeTransaction = null;
      try {
        if (mode === 'read') this.database.exec('PRAGMA query_only=OFF');
      } finally {
        release();
      }
    };
    const transaction: SqliteTransaction = {
      get closed() {
        return closed;
      },
      execute: async (statement) => {
        if (closed) throw new Error('The SQLite transaction is closed.');
        return this.executeNow(statement);
      },
      commit: async () => {
        finish('COMMIT');
      },
      rollback: async () => {
        finish('ROLLBACK');
      },
      close: () => {
        if (!closed) finish('ROLLBACK');
      },
    };
    this.activeTransaction = transaction;
    return transaction;
  }

  close(): void {
    if (this.ended) return;
    try {
      this.activeTransaction?.close();
    } finally {
      this.database.close();
      this.ended = true;
    }
  }
}
