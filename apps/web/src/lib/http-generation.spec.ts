import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import {
  createHttpDeckSource,
  createHttpExporter,
  createHttpGenerator,
  decodeGeneratedDeck,
  zipPreviews,
} from './http-generation';
import type { ExportRequest } from './deck-export';
import { mediaUrls } from './deck-source';
import { qrImageElement } from '../components/editor/qr-insert';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../packages/contracts/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  ).valid[0].payload;
const stored = {
  runId: 'run-test',
  title: 'Pilot',
  designSystem: fixture('GenerationProfile').designSystem,
  templateIr: fixture('CompositionExportResponse').templateIr,
};
const deck = decodeGeneratedDeck(stored);
const firstSlide = deck.slides[0];
if (!firstSlide) throw new Error('Expected fixture slide');
it('uses the engine-rendered first slide for the cover preview', () => {
  expect(deck.coverPreviewUrl).toBe('/api/backend/generation/run-test/artifacts/slide-1.png');
});

describe('deck source', () => {
  it('loads chat summaries separately from full editor decks', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return Response.json(stored);
    });
    const preview = await createHttpDeckSource({ summary: true }).getDeck('run-test');
    const full = await createHttpDeckSource().getDeck('run-test');
    expect(urls.map((url) => new URL(url).pathname)).toEqual([
      '/generation/run-test/summary',
      '/generation/run-test/deck',
    ]);
    expect(preview.coverPreviewUrl).toEqual(full.coverPreviewUrl);
  });

  it('aborts a stalled request rather than leaving the result card loading forever', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      );
      const pending = createHttpDeckSource({ summary: true, timeoutMs: 5 }).getDeck('run-test');
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(5);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
function input(): ExportRequest {
  return {
    deckId: deck.deckId,
    fileName: 'pilot',
    format: 'pptx',
    variant: 'balanced',
    slides: deck.slides,
    designSystem: deck.designSystem,
  };
}
afterEach(() => vi.unstubAllGlobals());
const source = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/export'))
        return Response.json({ exportId: 'export-test', previews: ['slide-1.png'] });
      if (path.endsWith('/deck')) return Response.json(stored);
      if (path.endsWith('/previews')) return Response.json(['slide-1.png']);
      if (path.endsWith('.png'))
        return new Response('png', { headers: { 'content-type': 'image/png' } });
      return new Response('artifact');
    }),
  );

describe('generated artifact download', () => {
  it('posts referenced image bytes once and returns the downloaded PPTX blob', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=';
    const file = new Blob([Buffer.from(png, 'base64')], { type: 'image/png' });
    const image = qrImageElement('upload/qr.png', { x: 0, y: 0, cx: 1104900, cy: 1104900 }, 'qr');
    const slides = [{ ...firstSlide, elements: [image, { ...image, elementId: 'copy' }] }];
    let posted: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        if (String(url).endsWith('/export')) {
          posted = JSON.parse(String(init?.body));
          return Response.json({ exportId: 'qr-export', previews: [] });
        }
        return new Response('pptx with QR', {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }),
    );
    const objectUrl = vi.fn((_blob: Blob) => 'blob:qr-pptx');
    vi.stubGlobal('URL', { createObjectURL: objectUrl });
    const result = await createHttpExporter({ file: () => file }).export(
      { ...input(), slides },
      vi.fn(),
      AbortSignal.timeout(1000),
    );
    expect(posted).toMatchObject({
      slides,
      media: [{ mediaPart: 'upload/qr.png', dataUrl: `data:image/png;base64,${png}` }],
    });
    expect(result.url).toBe('blob:qr-pptx');
    expect(await objectUrl.mock.calls[0]?.[0].text()).toBe('pptx with QR');
  });
  it('does not issue an export request when an image is missing or collection is cancelled', async () => {
    const image = qrImageElement(
      'upload/missing.png',
      { x: 0, y: 0, cx: 1104900, cy: 1104900 },
      'qr',
    );
    const slides = [{ ...firstSlide, elements: [image] }];
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createHttpExporter({ file: () => null }).export(
        { ...input(), slides },
        vi.fn(),
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Не найден файл');
    const controller = new AbortController();
    const blob = new Blob(['image'], { type: 'image/png' });
    vi.spyOn(blob, 'arrayBuffer').mockImplementation(async () => {
      controller.abort(new Error('cancelled'));
      return new ArrayBuffer(0);
    });
    await expect(
      createHttpExporter({ file: () => blob }).export(
        { ...input(), slides },
        vi.fn(),
        controller.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends auto as null and preserves the requested project', async () => {
    const fetcher = vi.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/generation')) {
        expect(JSON.parse(init.body)).toMatchObject({ slideCount: null, projectId: 'p' });
        return Response.json({ runId: 'run-test' });
      }
      if (path.includes('/events')) return Response.json([]);
      if (path.endsWith('/deck')) return Response.json(stored);
      return Response.json({ state: 'done' });
    });
    vi.stubGlobal('fetch', fetcher);
    await createHttpGenerator().generate(
      {
        templateId: 't',
        projectId: 'p',
        brief: 'Test briefing',
        files: [],
        slideCount: null,
        model: null,
      },
      vi.fn(),
      AbortSignal.timeout(2000),
    );
  });
  it.each([10, 12, 15])('sends the requested manual count of %i slides', async (slideCount) => {
    const fetcher = vi.fn(async (url, init) => {
      const path = String(url);
      if (path.endsWith('/generation/prepare')) return Response.json({ ready: true });
      if (path.endsWith('/generation')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ slideCount });
        return Response.json({ runId: 'run-test' });
      }
      if (path.includes('/events')) return Response.json([]);
      if (path.endsWith('/deck')) return Response.json(stored);
      return Response.json({ state: 'done' });
    });
    vi.stubGlobal('fetch', fetcher);
    await createHttpGenerator().generate(
      {
        templateId: 't',
        projectId: null,
        brief: 'Test briefing',
        files: [],
        slideCount,
        model: null,
      },
      vi.fn(),
      AbortSignal.timeout(2000),
    );
  });
  it('fails the generation when one of the three variants ends in a failed state', async () => {
    const fetcher = vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/generation/prepare')) return Response.json({ ready: true });
      if (path.endsWith('/generation')) {
        return Response.json({
          runId: 'run-primary',
          variants: [
            { variant: 'dense', runId: 'run-dense' },
            { variant: 'balanced', runId: 'run-primary' },
            { variant: 'airy', runId: 'run-airy' },
          ],
        });
      }
      if (path.includes('/events')) return Response.json([]);
      if (/\/runs\/run-airy$/.test(path)) return Response.json({ state: 'failed' });
      if (/\/runs\/[^/]+$/.test(path)) return Response.json({ state: 'done' });
      if (path.endsWith('/deck')) return Response.json(stored);
      return Response.json({ state: 'done' });
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createHttpGenerator().generate(
        {
          templateId: 't',
          projectId: null,
          brief: 'Test briefing',
          files: [],
          slideCount: null,
          model: null,
        },
        vi.fn(),
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow(/Вариант «airy» не был сгенерирован/);
  });
  it('exports a stored revision without sending the live slides', async () => {
    const calls: { url: string; body?: string }[] = [];
    const exportId = '6d1c0c3e-5b1a-4c2d-9e3f-1a2b3c4d5e6f';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { body?: BodyInit | null }) => {
        const path = String(url);
        calls.push({ url: path, body: init?.body == null ? undefined : String(init.body) });
        if (path.includes('/revisions/4/export')) {
          return Response.json({
            schemaVersion: 1,
            exportId,
            revision: 4,
            contentSha256: 'ab'.repeat(32),
            previews: [],
          });
        }
        return new Response('pptx', { headers: { 'content-type': 'application/octet-stream' } });
      }),
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:rev' });
    const result = await createHttpExporter().export(
      { ...input(), revision: 4, slideIds: ['s1'] },
      vi.fn(),
      AbortSignal.timeout(1000),
    );
    const posted = calls.find((call) => call.url.includes('/revisions/4/export'));
    expect(posted?.url).toContain('/editor/decks/run-test/revisions/4/export');
    expect(posted?.url).not.toContain('/generation/');
    expect(JSON.parse(posted?.body ?? '{}')).toEqual({
      schemaVersion: 1,
      format: 'pptx',
      variant: 'balanced',
      slideIds: ['s1'],
    });
    expect(calls.some((call) => call.url.includes('/generation/'))).toBe(false);
    expect(calls.map((call) => call.url)).toContain(
      `/api/backend/editor/decks/run-test/exports/${exportId}/deck.pptx`,
    );
    expect(result).toMatchObject({
      url: 'blob:rev',
      revision: 4,
      contentSha256: 'ab'.repeat(32),
    });
  });
  it('downloads the native PPTX through a local blob URL', async () => {
    source();
    const objectUrl = vi.fn(() => 'blob:pptx');
    vi.stubGlobal('URL', { createObjectURL: objectUrl });
    const result = await createHttpExporter().export(input(), vi.fn(), AbortSignal.timeout(1000));
    expect(result).toMatchObject({ fileName: 'pilot.pptx', url: 'blob:pptx' });
    expect(objectUrl).toHaveBeenCalledWith(expect.any(Blob));
  });
  it('does not mistake editor-only locks for content edits', async () => {
    source();
    const request = {
      ...input(),
      slides: deck.slides.map((s) => ({
        ...s,
        elements: s.elements.map((e) => ({ ...e, locked: true })),
      })),
    };
    await expect(
      createHttpExporter().export(request, vi.fn(), AbortSignal.timeout(1000)),
    ).resolves.toHaveProperty('url');
  });
  it('exports real geometry edits instead of rejecting them', async () => {
    source();
    const request = {
      ...input(),
      slides: deck.slides.map((s) => ({ ...s, slideCx: s.slideCx + 1 })),
    };
    await expect(
      createHttpExporter().export(request, vi.fn(), AbortSignal.timeout(1000)),
    ).resolves.toHaveProperty('url');
  });
  it('packages rendered PNG slides in a client-side ZIP archive', async () => {
    source();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:png') });
    const result = await createHttpExporter().export(
      { ...input(), format: 'png' },
      vi.fn(),
      AbortSignal.timeout(1000),
    );
    expect(result).toMatchObject({
      fileName: 'pilot.zip',
      url: 'blob:png',
    });
  });
  it('creates a ZIP with local file records and a central directory', async () => {
    const archive = await zipPreviews([
      { name: 'slide-1.png', blob: new Blob(['first']) },
      { name: 'slide-2.png', blob: new Blob(['second']) },
    ]);
    const data = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(data)).toContain('slide-1.png');
    expect(new TextDecoder().decode(data)).toContain('slide-2.png');
    expect(view.getUint32(data.length - 22, true)).toBe(0x06054b50);
  });
  it('builds a downloadable standalone HTML document from saved previews', async () => {
    const fetcher = vi.fn(async (url) => {
      const path = String(url);
      if (path.endsWith('/export'))
        return Response.json({ exportId: 'export-test', previews: ['slide-1.png'] });
      if (path.endsWith('/deck')) return Response.json(stored);
      if (path.endsWith('slide-1.png'))
        return new Response('png', { headers: { 'content-type': 'image/png' } });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await createHttpExporter().export(
      { ...input(), format: 'html' },
      vi.fn(),
      AbortSignal.timeout(1000),
    );
    expect(result.fileName).toBe('pilot.html');
    expect(result.url).toMatch(/^blob:/);
  });
  it('does not return the whole deck for a requested subset', async () => {
    source();
    await expect(
      createHttpExporter().export({ ...input(), slides: [] }, vi.fn(), AbortSignal.timeout(1000)),
    ).rejects.toThrow();
  });
  it('reports the two export stages as events, so the progress bar fills', async () => {
    const fetcher = vi.fn(async (url: URL | Request | string) => {
      const path = String(url);
      if (path.endsWith('/export')) return Response.json({ exportId: 'export-test', previews: [] });
      if (path.endsWith('deck.pptx'))
        return new Response('pptx', { headers: { 'content-type': 'application/octet-stream' } });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const events: JobEvent[] = [];
    await createHttpExporter().export(
      { ...input(), format: 'pptx' },
      (event) => events.push(event),
      AbortSignal.timeout(1000),
    );
    expect(events.at(-1)?.type).toBe('done');
    expect(
      events
        .filter(
          (event): event is JobEvent & { type: 'stage-started' } => event.type === 'stage-started',
        )
        .map((event) => event.stage),
    ).toEqual(['rendering', 'exporting']);
  });
  it('tells the server the format, so a PPTX export does not pay for PDF or previews', async () => {
    let sent: unknown = null;
    const fetcher = vi.fn(async (url: URL | Request | string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith('/export')) {
        sent = JSON.parse(String(init?.body));
        return Response.json({ exportId: 'export-test', previews: [] });
      }
      if (path.endsWith('deck.pptx'))
        return new Response('pptx', { headers: { 'content-type': 'application/octet-stream' } });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await createHttpExporter().export(
      { ...input(), format: 'pptx' },
      vi.fn(),
      AbortSignal.timeout(1000),
    );
    expect(result.fileName).toBe('pilot.pptx');
    expect(sent).toMatchObject({ format: 'pptx' });
  });
});

describe('a generated deck read back from its .pptx', () => {
  const imported = fixture('DeckImportResponse').slides;

  it('opens the slides the engine read from the file as they are', () => {
    const opened = decodeGeneratedDeck({ ...stored, slides: imported });
    expect(opened.slides).toEqual(imported);
    expect(opened.slides[0]?.backgroundImage).toBe('/ppt/media/image1.png');
  });

  it('rebuilds the slides from the template IR when the engine could not read the file', () => {
    expect(decodeGeneratedDeck({ ...stored, slides: [] }).slides).toEqual(deck.slides);
    expect(deck.slides.length).toBeGreaterThan(0);
  });

  it('resolves the picture a slide is painted with', () => {
    const opened = decodeGeneratedDeck({ ...stored, slides: imported });
    expect(mediaUrls(createHttpDeckSource(), opened)['/ppt/media/image1.png']).toBe(
      '/api/backend/generation/run-test/media/image1.png',
    );
  });

  it('serves a picture part by the name of its file', () => {
    expect(createHttpDeckSource().mediaUrl?.('run-test', '/ppt/media/image5.png')).toBe(
      '/api/backend/generation/run-test/media/image5.png',
    );
  });
});

describe('following a run on the server', () => {
  const server = { runId: 'run-test', variantRunIds: ['run-test'] };
  const noop = () => undefined;

  it('rides out a restart of the API and finishes the build', async () => {
    vi.useFakeTimers();
    let outage = 2;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const path = String(url);
        if (path.includes('/runs/run-test') && outage > 0) {
          outage -= 1;
          return new Response('Bad gateway', { status: 502 });
        }
        if (path.includes('/events')) return Response.json([]);
        if (path.endsWith('/runs/run-test')) return Response.json({ state: 'done' });
        if (path.endsWith('/deck')) return Response.json(stored);
        return new Response('missing', { status: 404 });
      }),
    );
    const { follow } = createHttpGenerator();
    if (!follow) throw new Error('The HTTP generator follows server runs');
    const result = follow(server, noop, new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ variants: [{ deckId: 'run-test' }] });
    vi.useRealTimers();
  });

  it('gives up on an answer that will not change', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'Run run-test was not found.' }, { status: 404 })),
    );
    const { follow } = createHttpGenerator();
    if (!follow) throw new Error('The HTTP generator follows server runs');
    await expect(follow(server, noop, new AbortController().signal)).rejects.toThrow(
      'Run run-test was not found.',
    );
  });
});
