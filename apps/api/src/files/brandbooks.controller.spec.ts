import { mkdtemp, mkdir, rm, writeFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../accounts/account-rules.js';
import type { AccountUsageService } from '../accounts/account-usage.service.js';
import { BrandbooksController } from './brandbooks.controller.js';
import { visibleFile } from './template-visibility.js';

const account = { id: 'owner' } as Account;
const profile = {
  schemaVersion: 1,
  parserVersion: '1',
  sourceSha256: 'a'.repeat(64),
  status: 'ready',
  sources: [
    {
      id: 'source',
      path: 'tokens.json',
      format: 'json',
      sha256: 'a'.repeat(64),
      sizeBytes: 2,
      status: 'parsed',
      warnings: [],
    },
  ],
  assets: [],
  tokens: [],
  sections: [],
  warnings: [],
  coverage: { filesTotal: 1, filesParsed: 1, filesUnsupported: 0, needsOcr: false },
};
const upload = (name = 'brand.json') => ({
  originalname: name,
  size: 2,
  buffer: Buffer.from('{}'),
});
const roots: string[] = [];
const pools: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((close) => close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(usage?: AccountUsageService) {
  const root = await mkdtemp(join(tmpdir(), 'brandbook-api-'));
  roots.push(root);
  const controller = new BrandbooksController(usage);
  const hidden = controller as unknown as {
    root: string;
    pool: { query: ReturnType<typeof vi.fn>; end: () => Promise<void> };
    engine: { parseBrandbook: ReturnType<typeof vi.fn> };
  };
  pools.push(hidden.pool.end.bind(hidden.pool));
  hidden.root = root;
  hidden.pool = { query: vi.fn().mockResolvedValue({ rows: [] }), end: async () => undefined };
  hidden.engine = { parseBrandbook: vi.fn().mockResolvedValue(profile) };
  return { controller, hidden, root };
}
describe('BrandbooksController', () => {
  it('rejects unsupported extensions before parsing or writing', async () => {
    const { controller, hidden, root } = await fixture();
    await expect(controller.upload(account, upload('brand.exe'))).rejects.toThrow('Unsupported');
    expect(hidden.engine.parseBrandbook).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it('rejects empty and oversized uploads', async () => {
    const { controller } = await fixture();
    await expect(controller.upload(account, { ...upload(), size: 0 })).rejects.toThrow();
    await expect(
      controller.upload(account, { ...upload(), size: 64 * 1024 * 1024 + 1 }),
    ).rejects.toThrow();
  });
  it('parses an original under a generated safe storage name and persists a validated profile', async () => {
    const { controller, hidden, root } = await fixture();
    const result = await controller.upload(account, upload('../../brand.json'));
    expect(result).toMatchObject({ kind: 'brandbook', mine: true, profile });
    expect(hidden.engine.parseBrandbook.mock.calls[0]?.[0]).toMatchObject({ schemaVersion: 1 });
    expect(hidden.engine.parseBrandbook.mock.calls[0]?.[0].path).toMatch(/original\.json$/);
    expect(hidden.pool.query.mock.calls[0]?.[1]).toContain('owner');
    expect((await readdir(join(root, 'brandbooks'))).length).toBe(1);
  });
  it('rejects malformed engine profiles and cleans staging without quota hooks', async () => {
    const { controller, hidden, root } = await fixture();
    hidden.engine.parseBrandbook.mockResolvedValue({ schemaVersion: 1 });
    await expect(controller.upload(account, upload())).rejects.toThrow();
    expect(await readdir(join(root, 'brandbooks'))).toEqual([]);
  });
  it('reserves unknown decompressed size with actual-size reconciliation and rolls back metadata', async () => {
    const write = vi.fn(async (_owner, _bytes, work, rollback) => {
      await work();
      await rollback();
      throw new Error('quota exceeded');
    });
    const { controller, hidden, root } = await fixture({ write } as unknown as AccountUsageService);
    await expect(controller.upload(account, upload())).rejects.toThrow('quota exceeded');
    expect(write.mock.calls[0]?.slice(0, 2)).toEqual(['owner', 64 * 1024 * 1024]);
    expect(hidden.pool.query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(true);
    expect(await readdir(join(root, 'brandbooks'))).toEqual([]);
  });
  it('filters profile lookup and listing by account ownership or sharing and excludes deletion', async () => {
    const { controller, hidden } = await fixture();
    await expect(controller.get(account, 'foreign')).rejects.toThrow();
    expect(hidden.pool.query.mock.calls[0]?.[0]).toContain(visibleFile(2));
    expect(hidden.pool.query.mock.calls[0]?.[1]).toEqual(['foreign', 'owner']);
    await controller.list(account);
    expect(hidden.pool.query.mock.calls[1]?.[0]).toContain(visibleFile(1));
  });
  it('streams only declared assets and denies traversal paths', async () => {
    const { controller, hidden, root } = await fixture();
    hidden.pool.query.mockResolvedValue({
      rows: [
        {
          id: 'book',
          owner_id: 'owner',
          storage_path: join(root, 'brandbooks/book/original.json'),
          profile: {
            ...profile,
            assets: [
              {
                id: 'logo',
                sourceId: 'source',
                path: '../secret',
                name: 'logo',
                kind: 'logo',
                mediaType: 'image/png',
                sha256: 'a'.repeat(64),
                sizeBytes: 2,
                width: null,
                height: null,
                fontFamily: null,
              },
            ],
          },
        },
      ],
    });
    await expect(controller.asset(account, 'book', 'logo')).rejects.toThrow();
    await expect(controller.asset(account, 'book', 'unknown')).rejects.toThrow();
  });
  it('rejects asset symlinks escaping extracted directory', async () => {
    const { controller, hidden, root } = await fixture();
    await mkdir(join(root, 'brandbooks/book/assets'), { recursive: true });
    await writeFile(join(root, 'secret'), 'secret');
    await symlink(join(root, 'secret'), join(root, 'brandbooks/book/assets/logo.png'));
    hidden.pool.query.mockResolvedValue({
      rows: [
        {
          id: 'book',
          owner_id: 'owner',
          storage_path: join(root, 'brandbooks/book/original.json'),
          profile: {
            ...profile,
            assets: [
              {
                id: 'logo',
                sourceId: 'source',
                path: 'logo.png',
                name: 'logo',
                kind: 'logo',
                mediaType: 'image/png',
                sha256: 'a'.repeat(64),
                sizeBytes: 2,
                width: null,
                height: null,
                fontFamily: null,
              },
            ],
          },
        },
      ],
    });
    await expect(controller.asset(account, 'book', 'logo')).rejects.toThrow();
  });
});
