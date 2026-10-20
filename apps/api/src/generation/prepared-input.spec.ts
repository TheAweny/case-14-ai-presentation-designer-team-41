import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareGenerationInput, preparedInputDependency } from './prepared-input.js';
import type { Dataset } from '@lct/contracts';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

afterEach(() => vi.useRealTimers());

function input() {
  return {
    engine: { extractMaterial: vi.fn() },
    brief: 'Facts',
    contentIds: ['one', 'two'],
    signal: new AbortController().signal,
    loadContent: vi.fn(async (id: string) => ({ sourceId: id, name: id, path: id })),
    assertOwner: vi.fn(async () => undefined),
    readMaterial: vi.fn(async () => ({ text: 'Prepared facts', sourceSha256: 'a'.repeat(64) })),
  };
}

describe('material preflight', () => {
  it('resumes from the accepted dataset snapshot without extraction; changed bytes require a new build', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'prepared-snapshot-'));
    try {
      const path = join(directory, 'facts.csv');
      const bytes = 'period,value\nOctober,0';
      await writeFile(path, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const options = input();
      options.contentIds = ['one'];
      options.loadContent.mockResolvedValue({ sourceId: 'one', name: 'facts.csv', path });
      options.readMaterial.mockResolvedValue({ text: bytes, sourceSha256: sha256 });
      const extractDataset = vi.fn(async (): Promise<Dataset> => ({
        datasetId: `dataset-${sha256.slice(0, 16)}`,
        status: 'ok',
        diagnostics: [],
        sheets: [],
        source: { fileName: 'facts.csv', sha256, bytes: bytes.length, mediaType: 'text/csv' },
      }));
      const engine = { ...options.engine, extractDataset };
      const accepted = await prepareGenerationInput({ ...options, engine });
      const snapshot = JSON.parse(JSON.stringify({ version: 1, ...accepted }));
      extractDataset.mockClear();
      options.readMaterial.mockClear();
      const resumed = await prepareGenerationInput({ ...options, engine, snapshot });
      expect(resumed.preparedDatasets).toEqual(accepted.preparedDatasets);
      expect(preparedInputDependency(['registry'], resumed)).toBe(
        preparedInputDependency(['registry'], accepted),
      );
      expect(extractDataset).not.toHaveBeenCalled();
      expect(options.readMaterial).not.toHaveBeenCalled();
      const modified = structuredClone(resumed);
      const modifiedDataset = modified.preparedDatasets[0];
      if (!modifiedDataset) throw new Error('Missing prepared dataset fixture');
      modifiedDataset.source.sha256 = 'f'.repeat(64);
      expect(preparedInputDependency(['registry'], modified)).not.toBe(
        preparedInputDependency(['registry'], accepted),
      );
      await writeFile(path, 'changed source');
      await expect(prepareGenerationInput({ ...options, engine, snapshot })).rejects.toThrow(
        'Исходный файл изменился',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('extracts CSV/TSV/XLSX sequentially and freezes their shared evidence snapshot', async () => {
    const options = input();
    options.contentIds = ['one.csv', 'two.tsv', 'three.xlsx'];
    const order: string[] = [];
    const extractDataset = vi.fn(async ({ path }: { path: string }): Promise<Dataset> => {
      order.push(path);
      return {
        schemaVersion: 1,
        datasetId: path,
        status: 'ok',
        diagnostics: [],
        sheets: [],
        source: { fileName: path, sha256: 'a'.repeat(64), bytes: 1, mediaType: 'text/csv' },
      };
    });
    const result = await prepareGenerationInput({
      ...options,
      engine: { ...options.engine, extractDataset },
    });
    expect(order).toEqual(options.contentIds);
    expect(result.preparedDatasets.map((dataset) => dataset.datasetId)).toEqual(options.contentIds);
    expect(Object.isFrozen(result.preparedDatasets)).toBe(true);
    expect(Object.isFrozen(result.preparedDatasets[0]?.source)).toBe(true);
    expect(extractDataset).toHaveBeenCalledTimes(3);
  });

  it('fails visibly when typed extraction failed or source bytes changed between readers', async () => {
    const options = input();
    options.contentIds = ['one.xlsx'];
    const dataset: Dataset = {
      datasetId: 'one',
      status: 'failed',
      diagnostics: [],
      sheets: [],
      source: {
        fileName: 'one.xlsx',
        sha256: 'a'.repeat(64),
        bytes: 1,
        mediaType: 'application/octet-stream',
      },
    };
    const engine = { ...options.engine, extractDataset: vi.fn(async () => dataset) };
    await expect(prepareGenerationInput({ ...options, engine })).rejects.toThrow(
      'Typed dataset extraction failed',
    );
    dataset.status = 'ok';
    dataset.source.sha256 = 'b'.repeat(64);
    await expect(prepareGenerationInput({ ...options, engine })).rejects.toThrow('source changed');
  });

  it('retains every prepared source for dataset injection and preserves source order', async () => {
    const options = input();
    const result = await prepareGenerationInput(options);
    expect(result.brief).toBe(
      'Facts\n\nSource one:\nPrepared facts\n\nSource two:\nPrepared facts',
    );
    expect(result.materials.map((m) => m.source.sourceId)).toEqual(['one', 'two']);
    expect(options.readMaterial).toHaveBeenCalledTimes(2);
    expect(options.assertOwner).toHaveBeenCalledTimes(7);
  });

  it('rejects ownership loss between sources and never reads the next file', async () => {
    const options = input();
    options.assertOwner.mockImplementation(async () => {
      if (options.readMaterial.mock.calls.length) throw new Error('lost ownership');
    });
    await expect(prepareGenerationInput(options)).rejects.toThrow('lost ownership');
    expect(options.readMaterial).toHaveBeenCalledTimes(1);
    expect(options.loadContent).toHaveBeenCalledTimes(1);
  });

  it('rejects a late partial response after Stop without proceeding to the next material', async () => {
    const options = input();
    const controller = new AbortController();
    options.signal = controller.signal;
    options.readMaterial.mockImplementation(async () => {
      controller.abort(new DOMException('Stop', 'AbortError'));
      return { text: 'late', sourceSha256: 'a'.repeat(64) };
    });
    await expect(prepareGenerationInput(options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(options.loadContent).toHaveBeenCalledTimes(1);
  });

  it('fails visibly on extraction errors and on total size, preserving the retryable reader', async () => {
    const options = input();
    options.readMaterial.mockRejectedValueOnce(new Error('extract failed'));
    await expect(prepareGenerationInput(options)).rejects.toThrow('extract failed');
    expect((await prepareGenerationInput(options)).materials).toHaveLength(2);
    options.readMaterial.mockResolvedValue({
      text: 'x'.repeat(60_000),
      sourceSha256: 'a'.repeat(64),
    });
    await expect(prepareGenerationInput(options)).rejects.toThrow('60000');
  });
});
