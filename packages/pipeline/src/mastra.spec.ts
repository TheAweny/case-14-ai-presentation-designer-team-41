import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocalStorageDirectory, createMastra, closeMastra } from './mastra.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Mastra storage setup', () => {
  it('releases the local database after shutdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lct-mastra-close-'));
    temporaryDirectories.push(root);
    const mastra = createMastra({ storageUrl: `file:${join(root, 'mastra.db')}` });
    await mastra.getStorage()?.init();
    await closeMastra(mastra);
    rmSync(root, { force: true, recursive: true });
  });
  it('creates the parent directory for a local LibSQL file', () => {
    const root = mkdtempSync(join(tmpdir(), 'lct-mastra-'));
    temporaryDirectories.push(root);
    const storageDirectory = join(root, 'nested', 'runs');

    ensureLocalStorageDirectory(`file:${join(storageDirectory, 'mastra.db')}`);

    expect(existsSync(storageDirectory)).toBe(true);
  });

  it('does not interpret remote LibSQL URLs as local paths', () => {
    expect(() => ensureLocalStorageDirectory('libsql://database.example')).not.toThrow();
  });
});
