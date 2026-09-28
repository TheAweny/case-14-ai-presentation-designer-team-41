import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import { createHttpExporter, createHttpGenerator, decodeGeneratedDeck } from './http-generation';
import type { ExportRequest } from './deck-export';

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
function input(): ExportRequest {
  return {
    deckId: deck.deckId,
    fileName: 'pilot',
    format: 'pptx',
    variant: 'balanced',
    slides: deck.slides,
    designSystem: deck.designSystem,
    audit: false,
  };
}
afterEach(() => vi.unstubAllGlobals());
const source = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(stored)),
  );

describe('generated artifact download', () => {
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
  it('returns the existing native PPTX for unchanged slides', async () => {
    source();
    const result = await createHttpExporter().export(input(), vi.fn(), AbortSignal.timeout(1000));
    expect(result.url).toContain('/generation/run-test/artifacts/deck.pptx');
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
  it('rejects real geometry edits with a visible failure event', async () => {
    source();
    const request = {
      ...input(),
      slides: deck.slides.map((s) => ({ ...s, slideCx: s.slideCx + 1 })),
    };
    const events: JobEvent[] = [];
    await expect(
      createHttpExporter().export(
        request,
        (e) => {
          events.push(e);
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('правок');
    expect(events.at(-1)).toMatchObject({ type: 'failed', retryable: false });
  });
  it('rejects unimplemented formats rather than producing a fake download', async () => {
    const events: JobEvent[] = [];
    await expect(
      createHttpExporter().export(
        { ...input(), format: 'html' },
        (e) => {
          events.push(e);
        },
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('PPTX');
    expect(events.at(-1)?.type).toBe('failed');
  });
  it('does not return the whole deck for a requested subset', async () => {
    source();
    await expect(
      createHttpExporter().export({ ...input(), slides: [] }, vi.fn(), AbortSignal.timeout(1000)),
    ).rejects.toThrow();
  });
});
