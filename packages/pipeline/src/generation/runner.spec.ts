import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation } from './runner.js';
import type { TextProvider } from './provider.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'),
  ).valid[0].payload;
const profile = generationProfileSchema.parse(fixture('GenerationProfile'));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function exercise(mode: 'clean' | 'repair' | 'unfixable' | 'cancel') {
  const outputDir = await mkdtemp(join(tmpdir(), 'deck-runner-'));
  directories.push(outputDir);
  const pattern = profile.compositions[0];
  if (!pattern) throw new Error('Missing fixture pattern');
  let checks = 0;
  let exports = 0;
  let repairs = 0;
  const events: string[] = [];
  const controller = new AbortController();
  if (mode === 'cancel') controller.abort(new Error('Cancelled test'));
  const provider: TextProvider = {
    model: 'offline-fixture',
    async generate<T>(
      agent: string,
      _instructions: string,
      input: unknown,
      schema: z.ZodType<T>,
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      if (agent === 'planner')
        return schema.parse({
          title: 'Pilot',
          slides: Array.from({ length: 10 }, (_, index) => ({
            patternId: pattern.patternId,
            purpose: `Pilot ${index + 1}`,
            imageQuery: '',
          })),
        });
      if (agent === 'rewriter') {
        repairs++;
        return schema.parse({
          rewrites: Object.fromEntries(
            pattern.slots.map((s) => [s.slotId, ['Pilot', 'Test', 'Go']]),
          ),
        });
      }
      if (agent === 'critic') return schema.parse({ issues: [] });
      if (typeof input === 'object' && input !== null && 'previous' in input) repairs++;
      return schema.parse({
        patternId: pattern.patternId,
        textsBySlot: Object.fromEntries(pattern.slots.map((s) => [s.slotId, 'Pilot'])),
        speakerNotes: 'Proposal',
      });
    },
  };
  const engine = new EngineClient({
    baseUrl: 'http://offline.test',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/composition-check')) {
        checks++;
        const findings =
          mode === 'unfixable' || (mode === 'repair' && checks === 1)
            ? [
                {
                  slideIndex: 0,
                  slotId: pattern.slots[0]?.slotId,
                  code: 'text-overflow',
                  severity: 'error',
                  lines: 3,
                  maxLines: 2,
                  maxChars: 20,
                  message: 'Shorten',
                },
              ]
            : [];
        return Response.json({ schemaVersion: 1, findings });
      }
      if (String(url).endsWith('/composition-audit')) {
        return Response.json({
          schemaVersion: 1,
          deckId: 'test',
          profile: 'composition',
          passed: true,
          score: 100,
          slideCount: 10,
          counts: { blocker: 0, major: 0, minor: 0, info: 0 },
          categories: [],
          findings: [],
        });
      }
      exports++;
      const outputPath = join(outputDir, 'deck.pptx');
      const pdfPath = join(outputDir, 'deck.pdf');
      await Promise.all([writeFile(outputPath, 'fixture-pptx'), writeFile(pdfPath, 'fixture-pdf')]);
      return Response.json({
        ...fixture('CompositionExportResponse'),
        outputPath,
        pdfPath,
        previews: [],
      });
    },
  });
  const result = generatePresentation({
    runId: 'test',
    templatePath: '/fixture.pptx',
    outputDir,
    brief: 'Pilot',
    slideCount: 10,
    profile,
    registryDir: resolve('../../registry/agents'),
    engine,
    provider,
    signal: controller.signal,
    onEvent: async (e) => {
      events.push(e.type);
    },
  });
  return { result, outputDir, events, counters: () => ({ checks, exports, repairs }) };
}

describe('real generation orchestration with offline dependencies', () => {
  it('writes manifest, audit and final events only after export', async () => {
    const run = await exercise('clean');
    const result = await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(result.manifest.artifacts.map((a) => a.kind)).toContain('audit');
    expect(JSON.parse(await readFile(join(run.outputDir, 'audit.json'), 'utf8'))).toHaveLength(1);
  });
  it('repairs just the affected slide through the Mastra repair workflow', async () => {
    const run = await exercise('repair');
    await run.result;
    expect(run.counters()).toEqual({ checks: 2, exports: 1, repairs: 1 });
  });
  it('does not export or mark done when fit still fails after bounded repair', async () => {
    const run = await exercise('unfixable');
    await expect(run.result).rejects.toThrow('Quality gate failed');
    expect(run.counters()).toEqual({ checks: 3, exports: 0, repairs: 2 });
    expect(run.events.at(-1)).toBe('failed');
    expect(JSON.parse(await readFile(join(run.outputDir, 'audit.json'), 'utf8'))).toHaveLength(3);
  });
  it('never calls the engine export on cancellation', async () => {
    const run = await exercise('cancel');
    await expect(run.result).rejects.toThrow();
    expect(run.counters().exports).toBe(0);
  });
});
