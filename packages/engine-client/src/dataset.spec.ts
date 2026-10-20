import { describe, expect, it } from 'vitest';
import { EngineClient, EngineHttpError } from './client.js';

const dataset = {
  schemaVersion: 1,
  datasetId: 'sales',
  status: 'partial',
  source: { fileName: 'sales.csv', mediaType: 'text/csv', bytes: 42, sha256: 'a'.repeat(64) },
  sheets: [],
  diagnostics: [
    { code: 'ambiguous-number', severity: 'warning', message: 'No unique reading', ref: 'B2' },
  ],
};
describe('typed dataset extraction', () => {
  it('validates and posts the request, forwards cancellation and preserves diagnostics', async () => {
    let sent: { url: string; init?: RequestInit } | undefined;
    const controller = new AbortController();
    const client = new EngineClient({
      baseUrl: 'http://engine/',
      fetchImpl: (async (url, init) => {
        sent = { url: String(url), init };
        return new Response(JSON.stringify(dataset));
      }) as typeof fetch,
    });
    expect(
      await client.extractDataset({ path: '/data/sales.csv' }, controller.signal),
    ).toMatchObject(dataset);
    expect(sent?.url).toBe('http://engine/v1/dataset-extract');
    expect(JSON.parse(String(sent?.init?.body))).toEqual({
      schemaVersion: 1,
      path: '/data/sales.csv',
    });
    controller.abort();
    expect(sent?.init?.signal?.aborted).toBe(true);
  });
  it('rejects malformed engine output', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ...dataset, status: 'guessed' }))) as typeof fetch,
    });
    await expect(client.extractDataset({ path: '/data/sales.csv' })).rejects.toThrow();
  });
  it('propagates engine failures without treating them as empty data', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine',
      fetchImpl: (async () => new Response('unavailable', { status: 503 })) as typeof fetch,
    });
    await expect(client.extractDataset({ path: '/data/sales.csv' })).rejects.toBeInstanceOf(
      EngineHttpError,
    );
  });
});
