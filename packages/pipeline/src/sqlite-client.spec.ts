import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteClient } from './sqlite-client.js';

const clients: NodeSqliteClient[] = [];
const directories: string[] = [];
function client() {
  const root = mkdtempSync(join(tmpdir(), 'lct-node-sqlite-'));
  directories.push(root);
  const database = new NodeSqliteClient(join(root, 'state.db'));
  clients.push(database);
  return { database, root };
}
afterEach(() => {
  for (const database of clients.splice(0)) database.close();
  for (const root of directories.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('NodeSqliteClient', () => {
  it('really releases a local file after statements and close, including on Windows', async () => {
    const { database, root } = client();
    await database.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY, title TEXT)');
    await database.execute({ sql: 'INSERT INTO sample (title) VALUES (?)', args: ['Презентация'] });
    expect((await database.execute('SELECT * FROM sample')).rows[0]).toMatchObject({
      title: 'Презентация',
    });
    database.close();
    database.close();
    expect(database.closed).toBe(true);
    rmSync(root, { force: true, recursive: true });
  });

  it('rolls back a failed batch atomically and permits subsequent operations', async () => {
    const { database } = client();
    await database.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY)');
    await expect(
      database.batch(['INSERT INTO sample VALUES (1)', 'INSERT INTO sample VALUES (1)']),
    ).rejects.toThrow();
    expect((await database.execute('SELECT COUNT(*) AS count FROM sample')).rows[0]?.count).toBe(0);
    await database.execute('INSERT INTO sample VALUES (2)');
  });

  it('queues operations from outside an interactive transaction until its commit', async () => {
    const { database } = client();
    await database.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY)');
    const transaction = await database.transaction('write');
    await transaction.execute('INSERT INTO sample VALUES (1)');
    let outsideDone = false;
    const outside = database.execute('SELECT COUNT(*) AS count FROM sample').then((result) => {
      outsideDone = true;
      return result;
    });
    await Promise.resolve();
    expect(outsideDone).toBe(false);
    await transaction.commit();
    expect((await outside).rows[0]?.count).toBe(1);
    expect(transaction.closed).toBe(true);
  });

  it('rolls back an uncommitted transaction when closed and releases its queue', async () => {
    const { database } = client();
    await database.execute('CREATE TABLE sample (id INTEGER PRIMARY KEY)');
    const transaction = await database.transaction('write');
    await transaction.execute('INSERT INTO sample VALUES (1)');
    const outside = database.execute('SELECT COUNT(*) AS count FROM sample');
    transaction.close();
    expect((await outside).rows[0]?.count).toBe(0);
    await expect(transaction.execute('SELECT 1')).rejects.toThrow();
  });

  it('binds named parameters, dates, booleans and binary values and reports affected rows', async () => {
    const { database } = client();
    await database.execute('CREATE TABLE sample (title TEXT, enabled INTEGER, at TEXT, data BLOB)');
    const result = await database.execute({
      sql: 'INSERT INTO sample VALUES ($title, $enabled, $at, $data)',
      args: {
        title: 'Отчёт',
        enabled: true,
        at: new Date('2026-10-15T00:00:00.000Z'),
        data: new Uint8Array([1, 2]),
      },
    });
    expect(result.rowsAffected).toBe(1);
    const selected = await database.execute('SELECT * FROM sample');
    expect(selected.rowsAffected).toBe(0);
    expect(selected.rows[0]).toMatchObject({
      title: 'Отчёт',
      enabled: 1,
      at: '2026-10-15T00:00:00.000Z',
    });
    expect(new Uint8Array(selected.rows[0]?.data as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
  });
});
