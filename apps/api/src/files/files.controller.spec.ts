import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { NotFoundException } from '@nestjs/common';
import type { StreamableFile } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import type { Account } from '../accounts/account-rules.js';
import { contentDisposition, originalDownloadName } from './content-disposition.js';
import { FilesController } from './files.controller.js';
import { visibleFile } from './template-visibility.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TEMPLATE = '33333333-3333-4333-8333-333333333333';
const OTHER_TEMPLATE = '44444444-4444-4444-8444-444444444444';

interface StoredRow {
  id: string;
  kind: 'template';
  file_name: string;
  storage_path: string;
  owner_id: string;
  shared: boolean;
  deleted_at: Date | null;
}

function account(id: string): Account {
  return {
    id,
    email: id + '@example.com',
    name: id,
    role: 'user',
    disabled: false,
    createdAt: '2026-10-18T00:00:00.000Z',
  };
}

function visibleTo(row: StoredRow, accountId: string): boolean {
  return row.deleted_at === null && (row.owner_id === accountId || row.shared);
}

describe('FilesController.downloadTemplate', () => {
  const roots: string[] = [];
  const closePools: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closePools.splice(0).map((close) => close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function controllerFor(root: string, rows: readonly StoredRow[]) {
    const seen: { sql: string; params: readonly unknown[] }[] = [];
    const controller = new FilesController();
    const hidden = controller as unknown as {
      root: string;
      pool: {
        query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: StoredRow[] }>;
        end: () => Promise<void>;
      };
    };
    closePools.push(hidden.pool.end.bind(hidden.pool));
    hidden.root = root;
    hidden.pool = {
      async query(sql, params = []) {
        seen.push({ sql, params });
        if (!sql.includes(visibleFile(2)) || !sql.includes("kind = 'template'")) {
          throw new Error('download query is not limited to a visible template: ' + sql);
        }
        const id = params[0];
        const accountId = params[1];
        if (typeof id !== 'string' || typeof accountId !== 'string') return { rows: [] };
        return { rows: rows.filter((row) => row.id === id && visibleTo(row, accountId)) };
      },
      async end() {
        return undefined;
      },
    };
    return { controller, seen };
  }

  async function rootDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'template-download-'));
    roots.push(root);
    return root;
  }

  async function writeTemplate(root: string, id: string, name: string, body: Buffer) {
    const directory = join(root, 'templates', id);
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, body);
    return path;
  }

  async function readBody(file: StreamableFile): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of file.getStream() as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  function stored(
    patch: Partial<StoredRow> & Pick<StoredRow, 'file_name' | 'storage_path'>,
  ): StoredRow {
    return {
      id: TEMPLATE,
      kind: 'template',
      owner_id: OWNER,
      shared: false,
      deleted_at: null,
      ...patch,
    };
  }

  it('serves the owner original bytes under the stored upload name', async () => {
    const root = await rootDir();
    const fileName = 'Шаблон квартала.pptx';
    const body = Buffer.from('PK\u0003\u0004 own-template-bytes');
    const otherBody = Buffer.from('other-template-bytes');
    const storagePath = await writeTemplate(root, TEMPLATE, fileName, body);
    const otherPath = await writeTemplate(root, OTHER_TEMPLATE, 'other.pptx', otherBody);
    const { controller, seen } = await controllerFor(root, [
      stored({ id: OTHER_TEMPLATE, file_name: 'other.pptx', storage_path: otherPath }),
      stored({ file_name: fileName, storage_path: storagePath }),
    ]);
    const file = await controller.downloadTemplate(TEMPLATE, account(OWNER));
    expect(await readBody(file)).toEqual(body);
    expect(file.getHeaders()).toMatchObject({
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      disposition: contentDisposition(fileName),
      length: body.length,
    });
    expect(originalDownloadName(fileName).toLowerCase().endsWith('.pptx')).toBe(true);
    expect(seen).toEqual([
      { sql: expect.stringContaining(visibleFile(2)), params: [TEMPLATE, OWNER] },
    ]);
    expect(seen[0]?.sql).toContain("kind = 'template'");
    expect(seen[0]?.sql).not.toContain(OTHER);
  });

  it('lets another account download a shared template and not a private or deleted one', async () => {
    const root = await rootDir();
    const body = Buffer.from('PK shared-potx-bytes');
    const storagePath = await writeTemplate(root, TEMPLATE, 'Brand.POTX', body);
    const shared = stored({
      file_name: 'Brand.POTX',
      storage_path: storagePath,
      owner_id: OTHER,
      shared: true,
    });
    const allowed = await controllerFor(root, [shared]);
    const file = await allowed.controller.downloadTemplate(TEMPLATE, account(OWNER));
    expect(await readBody(file)).toEqual(body);
    expect(file.getHeaders().type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.template',
    );
    expect(file.getHeaders().disposition).toBe(contentDisposition('Brand.POTX'));
    expect(originalDownloadName('Brand.POTX').toLowerCase().endsWith('.potx')).toBe(true);
    expect(allowed.seen[0]?.params).toEqual([TEMPLATE, OWNER]);

    const hidden = await controllerFor(root, [{ ...shared, shared: false }]);
    await expect(hidden.controller.downloadTemplate(TEMPLATE, account(OWNER))).rejects.toThrow(
      'Template not found.',
    );
    expect(hidden.seen[0]?.params).toEqual([TEMPLATE, OWNER]);

    const removed = await controllerFor(root, [{ ...shared, deleted_at: new Date() }]);
    await expect(removed.controller.downloadTemplate(TEMPLATE, account(OTHER))).rejects.toThrow(
      'Template not found.',
    );
    expect(removed.seen[0]?.params).toEqual([TEMPLATE, OTHER]);
  });

  it('reports a missing, empty, directory, or escaped file without leaking the path', async () => {
    const root = await rootDir();
    const directory = join(root, 'templates', TEMPLATE);
    await mkdir(directory, { recursive: true });
    const secret = join(root, 'secret.pptx');
    await writeFile(secret, Buffer.from('SECRET'));
    const emptyPath = await writeTemplate(root, TEMPLATE, 'empty.pptx', Buffer.alloc(0));
    const folder = join(directory, 'folder.pptx');
    await mkdir(folder);

    const cases: StoredRow[] = [
      stored({ file_name: 'gone.pptx', storage_path: join(directory, 'gone.pptx') }),
      stored({ file_name: 'empty.pptx', storage_path: emptyPath }),
      stored({ file_name: 'folder.pptx', storage_path: folder }),
      stored({ file_name: 'secret.pptx', storage_path: secret }),
    ];
    for (const item of cases) {
      const { controller } = await controllerFor(root, [item]);
      const error = await controller.downloadTemplate(TEMPLATE, account(OWNER)).then(
        () => {
          throw new Error('download should have failed for ' + item.file_name);
        },
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({ message: 'Template file is missing.' });
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(root);
    }
  });
});
