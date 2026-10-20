import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrandbookProfile } from '@lct/contracts';
import { snapshotBrandbook, sameBrandbook } from './brandbook-snapshot.js';

const profile: BrandbookProfile = {
  schemaVersion: 1,
  parserVersion: '1.0.0',
  sourceSha256: 'a'.repeat(64),
  status: 'ready',
  sources: [
    {
      id: 'source',
      path: 'brand.json',
      format: 'json',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      status: 'parsed',
      warnings: [],
    },
  ],
  tokens: [],
  assets: [],
  sections: [],
  warnings: [],
  coverage: { filesTotal: 1, filesParsed: 1, filesUnsupported: 0, needsOcr: false },
};
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe('immutable brandbook binding', () => {
  it('keeps legacy unbranded builds compatible', () => expect(sameBrandbook({}, {})).toBe(true));
  it('does not reuse unbranded decks for a brand', () =>
    expect(sameBrandbook({}, { brandbookId: 'one' })).toBe(false));
  it('does not reuse another brand', () =>
    expect(sameBrandbook({ brandbookId: 'one' }, { brandbookId: 'two' })).toBe(false));
  it('does not reuse a different priority', () =>
    expect(
      sameBrandbook({ brandbookId: 'one' }, { brandbookId: 'one', brandbookPriority: 'template' }),
    ).toBe(false));
  it('defaults brand priority consistently', () =>
    expect(
      sameBrandbook({ brandbookId: 'one' }, { brandbookId: 'one', brandbookPriority: 'brandbook' }),
    ).toBe(true));
  it('copies an asset and keeps it after source changes', async () => {
    root = await mkdtemp(join(tmpdir(), 'brand-snapshot-'));
    await mkdir(join(root, 'source', 'assets'), { recursive: true });
    await writeFile(join(root, 'source', 'assets', 'logo.svg'), 'logo');
    const input = {
      ...profile,
      assets: [
        {
          id: 'logo',
          sourceId: 'source',
          path: 'logo.svg',
          name: 'logo',
          kind: 'logo' as const,
          mediaType: 'image/svg+xml',
          sha256: 'b'.repeat(64),
          sizeBytes: 4,
          width: null,
          height: null,
          fontFamily: null,
        },
      ],
    };
    const binding = await snapshotBrandbook(
      input,
      join(root, 'source', 'brand.rar'),
      join(root, 'snapshot'),
      'brandbook',
    );
    await writeFile(join(root, 'source', 'assets', 'logo.svg'), 'changed');
    const copiedAsset = binding.profile.assets[0];
    const inputAsset = input.assets[0];
    expect(copiedAsset).toBeDefined();
    expect(inputAsset).toBeDefined();
    if (!copiedAsset || !inputAsset) throw new Error('asset fixture missing');
    expect(await readFile(copiedAsset.path, 'utf8')).toBe('logo');
    expect(inputAsset.path).toBe('logo.svg');
  });
  it('rejects asset traversal', async () => {
    root = await mkdtemp(join(tmpdir(), 'brand-snapshot-'));
    const input = {
      ...profile,
      assets: [
        {
          id: 'logo',
          sourceId: 'source',
          path: '../secret',
          name: 'logo',
          kind: 'logo' as const,
          mediaType: 'image/svg+xml',
          sha256: 'b'.repeat(64),
          sizeBytes: 4,
          width: null,
          height: null,
          fontFamily: null,
        },
      ],
    };
    await expect(
      snapshotBrandbook(
        input,
        join(root, 'source', 'brand.rar'),
        join(root, 'snapshot'),
        'brandbook',
      ),
    ).rejects.toThrow();
  });
});
