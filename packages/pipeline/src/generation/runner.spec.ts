import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation } from './runner.js';
import { minChars } from './workflow.js';
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

async function exercise(mode: 'clean' | 'repair' | 'unfixable' | 'cancel' | 'missing-font') {
  const outputDir = await mkdtemp(join(tmpdir(), 'deck-runner-'));
  directories.push(outputDir);
  const pattern = profile.compositions[0];
  if (!pattern) throw new Error('Missing fixture pattern');
  let checks = 0;
  let exports = 0;
  let repairs = 0;
  const events: string[] = [];
  const warnings: { stage: string; code: string; message: string }[] = [];
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
        // Slides of a real deck differ; the same text on all of them is a repeat the deck-wide
        // check would send to repair.
        // A text block is written to the fill its variant asks for, as a real writer does.
        textsBySlot: Object.fromEntries(
          pattern.slots.map((s) => {
            // A letter, not a number: a figure the brief lacks is a defect the runner repairs.
            const text = `Slide ${String.fromCharCode(65 + (input as { index: number }).index)}`;
            return [s.slotId, text.padEnd(minChars(s), ' point').trim()];
          }),
        ),
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
      const missingFonts = mode === 'missing-font' ? ['Template Face'] : [];
      return Response.json({
        ...fixture('CompositionExportResponse'),
        outputPath,
        pdfPath,
        previews: [],
        missingFonts,
        warnings:
          missingFonts.length > 0
            ? [
                'Fonts not installed on the render server: Template Face. The .pptx keeps the template fonts; previews use substitutes.',
              ]
            : fixture('CompositionExportResponse').warnings,
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
      if (e.type === 'warning') {
        warnings.push({ stage: e.stage, code: e.code, message: e.message });
      }
    },
  });
  return { result, outputDir, events, warnings, counters: () => ({ checks, exports, repairs }) };
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
    // One more check settles the fit before the export.
    expect(run.counters()).toEqual({ checks: 3, exports: 1, repairs: 1 });
  });
  it('still exports the deck when fit fails after bounded repair, warning instead of dropping the variant', async () => {
    const run = await exercise('unfixable');
    await run.result;
    // Three variants are mandatory: an unfixable overflow is reported, not fatal.
    // An engine that never accepts the slot gets every cut the fit settling tries, then the export.
    expect(run.counters()).toEqual({ checks: 11, exports: 1, repairs: 2 });
    expect(run.events.at(-1)).toBe('done');
    expect(JSON.parse(await readFile(join(run.outputDir, 'audit.json'), 'utf8'))).toHaveLength(3);
    expect(run.warnings.some((w) => w.code === 'content-review-required')).toBe(true);
  });
  it('never calls the engine export on cancellation', async () => {
    const run = await exercise('cancel');
    await expect(run.result).rejects.toThrow();
    expect(run.counters().exports).toBe(0);
  });
  it('turns a missing template font into an export warning and still finishes', async () => {
    const run = await exercise('missing-font');
    await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(run.warnings).toContainEqual({
      stage: 'exporting',
      code: 'fonts-substituted',
      message:
        'Шрифтов шаблона нет на сервере: Template Face. В .pptx они сохранены, превью нарисованы запасным шрифтом.',
    });
    const deck = JSON.parse(await readFile(join(run.outputDir, 'deck.json'), 'utf8')) as {
      warnings: string[];
    };
    expect(deck.warnings.some((warning) => warning.includes('Template Face'))).toBe(true);
  });
  it('does not warn about fonts when the server has every selected family', async () => {
    const run = await exercise('clean');
    await run.result;
    expect(run.warnings.some((warning) => warning.code === 'fonts-substituted')).toBe(false);
  });
});
