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

  it('reads a finished deck back as SlideIR and posts where its pictures go', async () => {
    let posted: { url: string; body: unknown } | undefined;
    const answer = {
      schemaVersion: 1,
      slides: [
        {
          schemaVersion: 1,
          slideId: 'imported-1',
          variant: 'balanced',
          index: 0,
          patternId: '/ppt/slideLayouts/slideLayout1.xml',
          slideCx: 12192000,
          slideCy: 6858000,
          backgroundImage: '/ppt/media/image1.png',
          elements: [],
        },
      ],
    };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      posted = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new EngineClient({ baseUrl: 'http://engine:8000', fetchImpl });
    const request = {
      schemaVersion: 1 as const,
      pptxPath: '/app/runs/run-1/deck.pptx',
      mediaDir: '/app/runs/run-1/media',
    };

    const imported = await client.importDeck(request);

    expect(posted).toEqual({ url: 'http://engine:8000/v1/deck-import', body: request });
    expect(imported.slides[0]?.backgroundImage).toBe('/ppt/media/image1.png');
  });

  it('rejects an imported deck whose slides break the SlideIR contract', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000',
      fetchImpl: fakeFetch(200, { schemaVersion: 1, slides: [{ slideId: 'no-box' }] }),
    });
    await expect(
      client.importDeck({ schemaVersion: 1, pptxPath: '/app/runs/run-1/deck.pptx' }),
    ).rejects.toThrowError();
  });
});
