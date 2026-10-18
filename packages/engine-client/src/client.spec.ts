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

  it('sends material extract defaults and the caller signal', async () => {
    const controller = new AbortController();
    let posted: { url: string; body: unknown; signal: AbortSignal | null } | undefined;
    const answer = {
      schemaVersion: 1,
      kind: 'text',
      sourceSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      segments: [
        {
          index: 0,
          locator: { page: 1, paragraph: 1, sheet: null, range: null },
          text: 'Первый абзац',
        },
      ],
      table: null,
      offset: 0,
      nextOffset: null,
      truncated: false,
      needsOcr: false,
      warnings: [],
    };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      posted = {
        url: String(url),
        body: JSON.parse(String(init?.body)),
        signal: init?.signal ?? null,
      };
      return new Response(JSON.stringify(answer), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new EngineClient({ baseUrl: 'http://engine:8000', fetchImpl });

    const extracted = await client.extractMaterial(
      { schemaVersion: 1, path: 'uploads/notes.md', format: 'text' },
      controller.signal,
    );

    expect(posted?.url).toBe('http://engine:8000/v1/material-extract');
    expect(posted?.body).toEqual({
      schemaVersion: 1,
      path: 'uploads/notes.md',
      format: 'text',
      offset: 0,
      limit: 20,
    });
    expect(posted?.signal?.aborted).toBe(false);
    controller.abort();
    expect(posted?.signal?.aborted).toBe(true);
    expect(extracted.segments[0]?.text).toBe('Первый абзац');
  });

  it('rejects a material extract response that breaks the contract', async () => {
    const client = new EngineClient({
      baseUrl: 'http://engine:8000',
      fetchImpl: fakeFetch(200, {
        schemaVersion: 1,
        kind: 'text',
        sourceSha256: 'abcd',
        segments: [],
        table: null,
        offset: 0,
        nextOffset: null,
        truncated: false,
        needsOcr: false,
        warnings: [],
      }),
    });
    await expect(
      client.extractMaterial({ schemaVersion: 1, path: 'uploads/notes.md', format: 'text' }),
    ).rejects.toThrowError();
  });

  it('aborts material extract when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let seen: AbortSignal | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      if (seen?.aborted) {
        throw seen.reason instanceof Error
          ? seen.reason
          : new DOMException('The operation was aborted.', 'AbortError');
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client = new EngineClient({ baseUrl: 'http://engine:8000', fetchImpl });

    await expect(
      client.extractMaterial(
        { schemaVersion: 1, path: 'uploads/notes.md', format: 'text' },
        controller.signal,
      ),
    ).rejects.toThrowError();
    expect(seen?.aborted).toBe(true);
  });
});
