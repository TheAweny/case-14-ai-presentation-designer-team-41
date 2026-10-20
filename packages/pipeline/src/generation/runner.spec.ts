import { readFileSync } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { compositionPlanSchema, generationProfileSchema } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation } from './runner.js';
import { minChars, SharedPlan } from './workflow.js';
import type { LayoutRemapPolicy } from './workflow.js';
import type { ModelRequest } from '../models/provider.js';
import { ModelAnswerValidationError, type TextProvider } from './provider.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'),
  ).valid[0].payload;
const profile = generationProfileSchema.parse(fixture('GenerationProfile'));
/** The same template with a badge the template drew with a sample figure, as a step marker is. */
const badgeProfile = (() => {
  const [first, ...others] = profile.compositions;
  const title = first?.slots[0];
  if (!first || !title) throw new Error('Missing fixture pattern');
  const badge = { ...title, slotId: 'badge', role: 'body' as const, sample: '05', maxChars: 6 };
  return { ...profile, compositions: [{ ...first, slots: [title, badge] }, ...others] };
})();
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function exercise(
  mode:
    | 'clean'
    | 'repair'
    | 'unfixable'
    | 'leaked-sample'
    | 'torn-word'
    | 'cancel'
    | 'missing-font'
    | 'post-export-repair'
    | 'factual-error'
    | 'reviewed'
    | 'self-corrected'
    | 'review-down'
    | 'recheck-import-down'
    | 'empty-import'
    | 'clean-vision'
    | 'critic-invalid'
    | 'critic-storage-failure'
    | 'critic-many-issues'
    | 'critic-late'
    | 'expired'
    | 'reserve-repair',
  layoutRemapPolicy?: LayoutRemapPolicy,
  onRepair?: () => void,
  omitClaims = false,
) {
  const outputDir = await mkdtemp(join(tmpdir(), 'deck-runner-'));
  directories.push(outputDir);
  const runProfile = mode === 'leaked-sample' ? badgeProfile : profile;
  const pattern = runProfile.compositions[0];
  if (!pattern || !pattern.slots[0]) throw new Error('Missing fixture pattern');
  const firstSlot = pattern.slots[0];
  let checks = 0;
  let exports = 0;
  let repairs = 0;
  let audits = 0;
  const exportedSlides: unknown[] = [];
  const criticInputs: {
    slides: { texts: { slotId: string; text: string }[] }[];
    contentHash?: string;
  }[] = [];
  const events: string[] = [];
  const seenPictures: string[] = [];
  let imports = 0;
  let engineCalls = 0;
  let modelCalls = 0;
  const reviewPasses = new Map<string, number>();
  const coveredReview =
    mode === 'reviewed' ||
    mode === 'self-corrected' ||
    mode === 'clean-vision' ||
    mode === 'critic-invalid';
  const warnings: { stage: string; code: string; message: string }[] = [];
  if (mode === 'critic-late')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], shouldAdvanceTime: true });
  const lateDeadline = Date.now() + 290_000;
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
      modelCalls++;
      if (agent === 'planner')
        return schema.parse({
          title: 'Pilot',
          slides: Array.from({ length: 10 }, (_, index) => ({
            patternId: pattern.patternId,
            purpose: `Pilot ${index + 1}`,
            imageQuery: '',
            requiredClaims: [
              {
                id: `claim-${index}`,
                text: `Slide ${String.fromCharCode(65 + index)}`,
                source: {
                  sourceId: 'brief',
                  quote: `Slide ${String.fromCharCode(65 + index)}`,
                },
              },
            ],
          })),
        });
      if (agent === 'rewriter') {
        repairs++;
        if (mode === 'reserve-repair') {
          onRepair?.();
          return new Promise<T>(() => undefined);
        }
        return schema.parse({
          slides: Object.fromEntries(
            (input as { slides: { index: number; slots: { slotId: string }[] }[] }).slides.map(
              (slide) => [
                String(slide.index),
                {
                  rewrites: Object.fromEntries(
                    slide.slots.map((s) => [s.slotId, ['Pilot', 'Test', 'Go']]),
                  ),
                },
              ],
            ),
          ),
        });
      }
      if (agent === 'critic') {
        criticInputs.push(structuredClone(input) as (typeof criticInputs)[number]);
        if (mode === 'critic-late' && exports > 0) {
          // The final check outlasts its stage: the clock jumps past it, short of the run's end.
          setImmediate(() => vi.advanceTimersByTime(lateDeadline - 2_500 - Date.now()));
          return new Promise<T>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        }
        if (mode === 'critic-invalid')
          throw new ModelAnswerValidationError(
            new SyntaxError('Invalid critic JSON after bounded retries'),
          );
        if (mode === 'critic-storage-failure') throw new SyntaxError('Checkpoint JSON is corrupt');
        if (mode === 'critic-many-issues')
          return schema.parse({
            issues: Array.from({ length: 15 }, (_, index) => ({
              slideIndex: index % 10,
              slotId: firstSlot.slotId,
              category: 'factual-error',
              message: `Missing condition ${index}`,
            })),
          });
        return schema.parse({
          issues:
            mode === 'factual-error' || mode === 'reserve-repair'
              ? [
                  {
                    slideIndex: 0,
                    slotId: firstSlot.slotId,
                    category: 'factual-error',
                    message: 'The condition from the source is missing.',
                  },
                ]
              : [],
        });
      }
      if (typeof input === 'object' && input !== null && 'previous' in input) repairs++;
      const copy = (index: number) => ({
        patternId: pattern.patternId,
        // Slides of a real deck differ; the same text on all of them is a repeat the deck-wide
        // check would send to repair.
        // A text block is written to the fill its variant asks for, as a real writer does.
        textsBySlot: Object.fromEntries(
          pattern.slots.map((s) => {
            // A writer that keeps the sample of a figure it has no fact for.
            if (mode === 'leaked-sample' && s.slotId === 'badge') return [s.slotId, s.sample];
            // A letter, not a number: a figure the brief lacks is a defect the runner repairs.
            const text = `Slide ${String.fromCharCode(65 + index)}`;
            return [s.slotId, text.padEnd(minChars(s), ' point').trim()];
          }),
        ),
        speakerNotes: 'Proposal',
      });
      return schema.parse({
        slides: Object.fromEntries(
          (input as { slides: { index: number }[] }).slides.map((slide) => [
            String(slide.index),
            copy(slide.index),
          ]),
        ),
      });
    },
  };
  const engine = new EngineClient({
    baseUrl: 'http://offline.test',
    fetchImpl: async (url, init) => {
      engineCalls++;
      if (String(url).endsWith('/composition-check')) {
        checks++;
        const findings =
          mode === 'unfixable' || mode === 'torn-word' || (mode === 'repair' && checks === 1)
            ? [
                {
                  slideIndex: 0,
                  slotId: pattern.slots[0]?.slotId,
                  code: mode === 'torn-word' ? 'word-break' : 'text-overflow',
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
        audits++;
        const findings =
          mode === 'post-export-repair' && audits === 1
            ? [
                {
                  schemaVersion: 1,
                  findingId: 'post-export',
                  origin: 'deterministic',
                  confidence: 1,
                  fixability: 'assisted',
                  checkId: 'placeholder-text',
                  category: 'content',
                  severity: 'major',
                  title: 'Replace text',
                  detail: 'The copy needs a repair.',
                  target: {
                    slideId: 's1',
                    elementId: `slot-${firstSlot.slotId}`,
                    variant: 'balanced',
                    box: null,
                  },
                  evidence: {
                    measured: 'old',
                    expected: 'repaired',
                    quote: '',
                    sources: [],
                    screenshot: '',
                  },
                  proposedPatch: null,
                },
              ]
            : [];
        return Response.json({
          schemaVersion: 1,
          deckId: 'test',
          profile: 'composition',
          passed: findings.length === 0,
          score: 100,
          slideCount: 10,
          counts: { blocker: 0, major: 0, minor: 0, info: 0 },
          categories: [],
          findings,
        });
      }
      if (String(url).endsWith('/deck-import')) {
        imports++;
        if (mode === 'empty-import') {
          return Response.json({ ...fixture('DeckImportResponse'), slides: [] });
        }
        if (mode === 'recheck-import-down' && imports > 1) {
          return new Response('import down', { status: 500 });
        }
        const imported = fixture('DeckImportResponse') as {
          slides: { slideId: string }[];
        };
        if (!coveredReview) return Response.json(imported);
        return Response.json({
          ...imported,
          slides: Array.from({ length: exportedSlides.length }, (_, index) => ({
            ...imported.slides[0],
            slideId: `imported-${index + 1}`,
          })),
        });
      }
      exports++;
      const bodySlides = JSON.parse(String(init?.body)).slides as unknown[];
      exportedSlides.splice(0, exportedSlides.length, ...bodySlides);
      const outputPath = join(outputDir, 'deck.pptx');
      const pdfPath = join(outputDir, 'deck.pdf');
      await Promise.all([writeFile(outputPath, 'fixture-pptx'), writeFile(pdfPath, 'fixture-pdf')]);
      const missingFonts = mode === 'missing-font' ? ['Template Face'] : [];
      const previewCount = coveredReview ? bodySlides.length : 1;
      const previews = await Promise.all(
        Array.from({ length: previewCount }, async (_, index) => {
          const preview = join(outputDir, `slide-${index + 1}.png`);
          await writeFile(preview, 'fixture-png');
          return preview;
        }),
      );
      return Response.json({
        ...fixture('CompositionExportResponse'),
        outputPath,
        pdfPath,
        previews,
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
    brief: Array.from(
      { length: 10 },
      (_, index) => `Slide ${String.fromCharCode(65 + index)}`,
    ).join('\n'),
    slideCount: 10,
    profile: runProfile,
    registryDir: resolve('../../registry/agents'),
    engine,
    provider,
    ...(omitClaims
      ? {
          // A persisted legacy plan may predate required claims; its visual pass is insufficient.
          sharedPlan: new SharedPlan(
            compositionPlanSchema.parse({
              title: 'Pilot',
              slides: Array.from({ length: 10 }, (_, index) => ({
                patternId: pattern.patternId,
                purpose: `Pilot ${index + 1}`,
                imageQuery: '',
              })),
            }),
          ),
        }
      : {}),
    ...(layoutRemapPolicy ? { layoutRemapPolicy } : {}),
    ...(mode === 'reviewed' ||
    mode === 'self-corrected' ||
    mode === 'review-down' ||
    mode === 'recheck-import-down' ||
    mode === 'empty-import' ||
    mode === 'clean-vision'
      ? {
          reviewer: {
            model: 'vlm-fixture',
            provider: {
              name: 'vlm-fixture',
              complete: (request: ModelRequest) => {
                seenPictures.push(...(request.images ?? []));
                if (mode === 'review-down') return Promise.reject(new Error('runtime down'));
                const slideId = (request.input as { slideId: string }).slideId;
                const pass = (reviewPasses.get(slideId) ?? 0) + 1;
                reviewPasses.set(slideId, pass);
                const clean =
                  mode === 'clean-vision' ||
                  mode === 'empty-import' ||
                  slideId !== 'imported-1' ||
                  (mode === 'self-corrected' && pass > 1);
                return Promise.resolve(
                  JSON.stringify({
                    schemaVersion: 1,
                    slideId,
                    answers: [
                      {
                        checkId: 'no-service-text',
                        verdict: clean ? 'yes' : 'no',
                        confidence: 0.95,
                        evidence: 'Slide',
                        suggestion: '',
                      },
                    ],
                  }),
                );
              },
            },
          },
        }
      : {}),
    ...(mode === 'expired' ? { deadlineAt: Date.now() - 1 } : {}),
    ...(mode === 'critic-late' ? { deadlineAt: lateDeadline } : {}),
    signal: controller.signal,
    onEvent: async (e) => {
      events.push(e.type);
      if (e.type === 'warning') {
        warnings.push({ stage: e.stage, code: e.code, message: e.message });
      }
    },
  });
  return {
    result,
    outputDir,
    events,
    warnings,
    exportedSlides,
    criticInputs,
    seenPictures,
    counters: () => ({ checks, exports, repairs, audits, engineCalls, modelCalls, imports }),
  };
}

describe('real generation orchestration with offline dependencies', () => {
  it('exports accepted copy with explicit unknown review when the critic returns invalid JSON', async () => {
    const run = await exercise('critic-invalid');
    await run.result;
    expect(run.counters().exports).toBe(1);
    expect(run.events.at(-1)).toBe('done');
    expect(run.warnings.some((warning) => warning.message.includes('критика не прошёл'))).toBe(
      true,
    );
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8'));
    expect(review.status).toBe('unknown');
    expect(review.warnings).toBeGreaterThan(0);
    const history = JSON.parse(await readFile(join(run.outputDir, 'audit.json'), 'utf8'));
    expect(history.at(-1).criticStatus).toBe('unavailable');
  });
  it('retains more than twelve semantic findings across the full deck', async () => {
    const run = await exercise('critic-many-issues');
    await run.result;
    expect(run.events.at(-1)).toBe('done');
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8'));
    expect(review.issues).toHaveLength(15);
    expect(review.contextual.errors).toBe(15);
  });
  it('keeps the written deck, unreviewed, when the final check runs out of time', async () => {
    const run = await exercise('critic-late');
    await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(run.warnings.some((warning) => warning.message.includes('не успела'))).toBe(true);
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8'));
    expect(review.status).toBe('unknown');
  });
  it('keeps checkpoint corruption fatal instead of treating it as an unavailable critic', async () => {
    const run = await exercise('critic-storage-failure');
    await expect(run.result).rejects.toThrow('Checkpoint JSON is corrupt');
    expect(run.counters().exports).toBe(0);
    expect(run.events.at(-1)).toBe('failed');
  });
  it('keeps coverage unknown even when every rendered slide passes visual review', async () => {
    const run = await exercise('clean-vision', undefined, undefined, true);
    await run.result;
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8'));
    expect(review).toMatchObject({ status: 'unknown', coverage: { total: 0, covered: 0 } });
    expect(run.warnings.some((warning) => warning.message.includes('набора требований'))).toBe(
      true,
    );
  });

  it('aborts a stalled repair before the 60s reserve and still exports and audits accepted text', async () => {
    vi.useFakeTimers();
    let entered!: () => void;
    const repairing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const run = await exercise('reserve-repair', undefined, entered);
    await repairing;
    await vi.advanceTimersByTimeAsync(230_000);
    const result = await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(run.counters().exports).toBeGreaterThan(0);
    expect(run.counters().audits).toBeGreaterThan(0);
    expect(
      run.warnings.some((warning) => warning.message.includes('Время исправлений исчерпано')),
    ).toBe(true);
    expect(result.manifest.totalMs).toBeLessThan(290_000);
    expect(result.manifest.artifacts.map((artifact) => artifact.kind)).toContain('pptx');
  });

  it('writes manifest, audit and final events only after export', async () => {
    const run = await exercise('clean');
    const result = await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(result.manifest.artifacts.map((a) => a.kind)).toContain('audit');
    const policy = result.manifest.revisions.find((item) => item.id === 'layout-remap-policy');
    expect(policy).toMatchObject({ kind: 'config', version: '1.0.0' });
    const strict = await exercise('clean', 'preserve-block-count');
    const strictPolicy = (await strict.result).manifest.revisions.find(
      (item) => item.id === 'layout-remap-policy',
    );
    expect(strictPolicy?.hash).not.toBe(policy?.hash);
    const history = JSON.parse(await readFile(join(run.outputDir, 'audit.json'), 'utf8'));
    expect(history.at(-1).contentHash).toBe(result.manifest.contentHash);
  });
  it('repairs just the affected slide through the Mastra repair workflow', async () => {
    const run = await exercise('repair');
    await run.result;
    // One more check settles the fit before the export.
    expect(run.counters()).toMatchObject({ checks: 3, exports: 1, repairs: 1 });
  });
  it('refuses export when bounded repair cannot fit the complete content', async () => {
    const run = await exercise('unfixable');
    await expect(run.result).rejects.toThrow(/fit|overflow|помещ/i);
    expect(run.counters().exports).toBe(0);
    expect(run.events.at(-1)).toBe('failed');
    expect(JSON.parse(await readFile(join(run.outputDir, 'failure.json'), 'utf8'))).toMatchObject({
      requiresReview: true,
    });
  });
  it('empties a figure the template drew as a sample and no fact stands behind, and says so', async () => {
    const run = await exercise('leaked-sample');
    await run.result;
    expect(
      run.warnings.some((w) => w.code === 'template-sample-removed' && w.message.includes('«05»')),
    ).toBe(true);
    // The engine gets the slot empty, so it takes the badge off the slide; the title is the writer's.
    const slide = run.exportedSlides[0] as { texts: { slotId: string; text: string }[] };
    expect(slide.texts.find((t) => t.slotId === 'badge')?.text).toBe('');
    expect(slide.texts.find((t) => t.slotId !== 'badge')?.text).not.toBe('');
  });
  it('sends a torn word to the rewriter but never refuses the export for it', async () => {
    const run = await exercise('torn-word');
    await run.result;
    // The engine keeps reporting the word, the rewriter was asked, and the deck is still given.
    expect(run.counters().repairs).toBeGreaterThan(0);
    expect(run.counters().exports).toBe(1);
    expect(run.events.at(-1)).toBe('done');
  });
  it('saves and semantically audits the exact final content after a post-export repair', async () => {
    const run = await exercise('post-export-repair');
    await run.result;
    const saved = JSON.parse(await readFile(join(run.outputDir, 'plan.json'), 'utf8'));
    expect(saved.map((s: { slide: unknown }) => s.slide)).toEqual(run.exportedSlides);
    const finalTexts = run.exportedSlides.map(
      (s) => (s as { texts: { slotId: string; text: string }[] }).texts,
    );
    expect(
      run.criticInputs
        .at(-1)
        ?.slides.map((s) => s.texts.map(({ slotId, text }) => ({ slotId, text }))),
    ).toEqual(finalTexts);
  });
  it('includes remaining semantic errors in the final review despite clean geometry', async () => {
    const run = await exercise('factual-error');
    await run.result;
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8'));
    expect(review.contextual.errors).toBeGreaterThan(0);
    expect(review.errors).toBeGreaterThan(0);
    expect(review.status).toBe('unknown');
    expect(review.contentHash).toBe(run.criticInputs.at(-1)?.contentHash);
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
  it('asks the content questions of the picture of every slide and keeps the answers in the run', async () => {
    const run = await exercise('reviewed');
    const result = await run.result;
    expect(run.events.at(-1)).toBe('done');
    // Every written slide is asked about, then the rewritten one again.
    const picture = `data:image/png;base64,${Buffer.from('fixture-png').toString('base64')}`;
    expect(run.seenPictures).toEqual(Array.from({ length: 11 }, () => picture));
    const contextual = JSON.parse(
      await readFile(join(run.outputDir, 'audit-contextual.json'), 'utf8'),
    ) as { model: string; findings: { origin: string }[] };
    expect(contextual.model).toBe('vlm-fixture');
    expect(contextual.findings[0]?.origin).toBe('contextual');
    expect(result.manifest.artifacts.map((a) => a.path)).toContain('audit-contextual.json');
    // A blocker in the picture counts in the final review, so the deck is not called complete.
    const finalReview = JSON.parse(
      await readFile(join(run.outputDir, 'final-review.json'), 'utf8'),
    ) as { status: string; contextual: { errors: number } | null; errors: number };
    expect(finalReview.status).toBe('requires-review');
    expect(finalReview.contextual?.errors).toBeGreaterThanOrEqual(1);
    expect(finalReview.errors).toBeGreaterThanOrEqual(1);
    // A slide read back from the file is `imported-1`: the lane names its number, not its id.
    expect(run.warnings.find((w) => w.message.startsWith('Смысловой аудит'))?.message).toMatch(
      /^Смысловой аудит, слайд 1: /,
    );
    expect(result.manifest.revisions).toContainEqual(
      expect.objectContaining({ kind: 'model', id: 'vlm-fixture' }),
    );
    expect(result.manifest.revisions).toContainEqual(
      expect.objectContaining({ kind: 'agent', id: 'slide-reviewer' }),
    );
  });
  it('sends what the picture showed back to the rewriter and keeps what it found and fixed', async () => {
    const run = await exercise('self-corrected');
    const result = await run.result;
    expect(run.counters().repairs).toBe(1);
    const check = JSON.parse(await readFile(join(run.outputDir, 'self-check.json'), 'utf8')) as {
      pictureReviewed: boolean;
      rounds: {
        found: { deterministic: number; contextual: number };
        corrected: { slide: number; slotId: string; source: string }[];
        after: { deterministic: number; contextual: number };
      }[];
      remaining: { deterministic: number; contextual: number };
    };
    expect(check.pictureReviewed).toBe(true);
    expect(check.rounds).toHaveLength(1);
    expect(check.rounds[0]?.found.contextual).toBe(1);
    expect(check.rounds[0]?.corrected).toEqual([{ slide: 1, slotId: '2', source: 'contextual' }]);
    expect(check.rounds[0]?.after.contextual).toBe(0);
    expect(check.remaining.contextual).toBe(0);
    const contextual = JSON.parse(
      await readFile(join(run.outputDir, 'audit-contextual.json'), 'utf8'),
    ) as { findings: unknown[] };
    expect(contextual.findings).toEqual([]);
    expect(result.manifest.artifacts.map((a) => a.path)).toContain('self-check.json');
    // Nothing is left to ask the user about, so no warning names a slide of the picture review.
    expect(run.warnings.some((w) => w.message.startsWith('Смысловой аудит, слайд'))).toBe(false);
  });
  it('keeps what is still wrong after the round and says so', async () => {
    const run = await exercise('reviewed');
    await run.result;
    const check = JSON.parse(await readFile(join(run.outputDir, 'self-check.json'), 'utf8')) as {
      rounds: { after: { contextual: number } }[];
      remaining: { contextual: number };
    };
    expect(check.rounds[0]?.after.contextual).toBe(1);
    expect(check.remaining.contextual).toBe(1);
  });
  it('finishes the variant and says so when the vision model is down', async () => {
    const run = await exercise('review-down');
    const result = await run.result;
    expect(run.events.at(-1)).toBe('done');
    expect(run.warnings.some((w) => w.code === 'contextual-audit-failed')).toBe(true);
    expect(result.manifest.revisions.some((r) => r.id === 'vlm-fixture')).toBe(true);
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8')) as {
      status: string;
    };
    expect(review.status).toBe('unknown');
  });
  it('has no contextual audit when no model is assigned to the role', async () => {
    const run = await exercise('clean');
    const result = await run.result;
    expect(run.seenPictures).toEqual([]);
    expect(result.manifest.artifacts.map((a) => a.path)).not.toContain('audit-contextual.json');
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8')) as {
      status: string;
      contextual: { errors: number } | null;
    };
    expect(review.status).toBe('unknown');
    expect(review.contextual).not.toBeNull();
    const check = JSON.parse(await readFile(join(run.outputDir, 'self-check.json'), 'utf8')) as {
      pictureReviewed: boolean;
      rounds: unknown[];
    };
    expect(check).toMatchObject({ pictureReviewed: false, rounds: [] });
    expect(run.warnings.some((w) => w.code === 'contextual-audit-skipped')).toBe(true);
  });
  it('calls a clean picture review complete', async () => {
    const run = await exercise('clean-vision');
    await run.result;
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8')) as {
      status: string;
    };
    expect(review.status).toBe('complete');
  });
  it('drops a stale picture review when the recheck cannot import the rewritten deck', async () => {
    const run = await exercise('recheck-import-down');
    const result = await run.result;
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8')) as {
      status: string;
    };
    expect(review.status).toBe('unknown');
    const check = JSON.parse(await readFile(join(run.outputDir, 'self-check.json'), 'utf8')) as {
      rounds: { after: unknown }[];
    };
    expect(check.rounds[0]?.after).toBeNull();
    expect(result.manifest.artifacts.map((a) => a.path)).not.toContain('audit-contextual.json');
    await expect(access(join(run.outputDir, 'audit-contextual.json'))).rejects.toThrow();
  });
  it('does not call a deck with an empty picture import reviewed', async () => {
    const run = await exercise('empty-import');
    await run.result;
    const review = JSON.parse(await readFile(join(run.outputDir, 'final-review.json'), 'utf8')) as {
      status: string;
    };
    expect(review.status).toBe('unknown');
    expect(run.seenPictures).toEqual([]);
  });
  it('does not start the engine or the model when the deadline has already passed', async () => {
    const run = await exercise('expired');
    await expect(run.result).rejects.toThrow();
    expect(run.counters()).toMatchObject({ engineCalls: 0, modelCalls: 0, exports: 0 });
  });
});
