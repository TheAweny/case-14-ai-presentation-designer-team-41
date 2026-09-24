import { describe, expect, it } from 'vitest';
import { EngineClient, EngineHttpError } from './client.js';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('EngineClient', () => {
  it('validates a healthy response against the shared contract', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000/',
      fetchImpl: fakeFetch(200, {
        status: 'ok',
        service: 'engine',
        version: '0.1.0',
        uptimeSeconds: 3,
      }),
    });
    await expect(client.health()).resolves.toMatchObject({ status: 'ok', service: 'engine' });
  });

  it('turns a non-2xx answer into EngineHttpError', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000',
      fetchImpl: fakeFetch(503, { detail: 'starting' }),
    });
    await expect(client.health()).rejects.toBeInstanceOf(EngineHttpError);
  });

  it('rejects a response that does not match the contract', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000',
      fetchImpl: fakeFetch(200, { status: 'fine' }),
    });
    await expect(client.health()).rejects.toThrowError();
  });

  it('posts a validated editable deck request to the engine', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000',
      fetchImpl: fakeFetch(200, {
        schemaVersion: 1,
        outputPath: '/app/runs/run-1/deck.pptx',
        designSystem: { schemaVersion: 1 },
        slideCount: 1,
      }),
    });

    await expect(
      client.createEditableDeck({
        schemaVersion: 1,
        runId: 'run-1',
        templatePath: '/app/data/template.pptx',
        outputPath: '/app/runs/run-1/deck.pptx',
        slides: [{ slideId: 'slide-1', title: 'Title', body: 'Body' }],
      }),
    ).resolves.toMatchObject({ slideCount: 1 });
  });
});
