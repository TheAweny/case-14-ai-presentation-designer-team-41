import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  generationProfileSchema,
  type CompositionExportRequest,
  type CompositionNote,
} from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation } from './runner.js';
import { SharedPlan } from './workflow.js';
import { SharedIllustrations } from './illustrations.js';
import type { TextProvider } from './provider.js';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/fixtures/${name}.json`, import.meta.url), 'utf8'),
  ).valid[0].payload;
const base = generationProfileSchema.parse(fixture('GenerationProfile'));
const first = base.compositions[0];
if (!first) throw new Error('Missing fixture composition.');
const pattern = {
  ...first,
  imageSlots: [
    { slotId: '3', kind: 'photo' as const, box: { x: 0, y: 0, cx: 5_000_000, cy: 5_000_000 } },
  ],
  qrCandidateSlots: [
    { slotId: '3', kind: 'photo' as const, box: { x: 0, y: 0, cx: 5_000_000, cy: 5_000_000 } },
  ],
};
const profile = { ...base, compositions: [pattern] };
const note: CompositionNote = {
  patternId: pattern.patternId,
  kind: 'statement',
  title: 'QR link',
  items: 1,
  useFor: 'QR link',
  skip: false,
  special: true,
  qrSlotIds: ['3'],
  requiredContent: [],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('automatic QR generation runner', () => {
  it.each([true, false])(
    'shares one plan across three variants and preserves QR through both repairs (image provider configured: %s)',
    async (imagesConfigured) => {
      const url = 'https://example.test/путь?sig=(x)&encoded=%2f;';
      const registryDir = resolve('../../registry/agents');
      const signal = AbortSignal.timeout(30_000);
      const imageGenerate = vi.fn(async () => {
        throw new Error('QR must never call the image provider');
      });
      let plannerCalls = 0;
      const sharedPlan = new SharedPlan();
      const results = await Promise.all(
        (['dense', 'balanced', 'airy'] as const).map(async (variant) => {
          const outputDir = await mkdtemp(join(tmpdir(), `runner-qr-${variant}-`));
          directories.push(outputDir);
          let critiques = 0;
          let repairs = 0;
          let audits = 0;
          const exports: CompositionExportRequest[] = [];
          const checks: CompositionExportRequest[] = [];
          const provider: TextProvider = {
            model: 'offline-qr',
            async generate<T>(
              role: string,
              _instructions: string,
              input: unknown,
              schema: z.ZodType<T>,
            ) {
              if (role === 'planner') {
                plannerCalls++;
                expect(input).toMatchObject({ allowedQrUrls: [url] });
                return schema.parse({
                  title: 'QR deck',
                  slides: Array.from({ length: 10 }, (_, index) => ({
                    patternId: pattern.patternId,
                    purpose: `Point ${String.fromCharCode(65 + index)}`,
                    qrRequests: [{ slotId: '3', url }],
                    imageQuery: '',
                  })),
                });
              }
              if (role === 'critic') {
                return schema.parse({
                  issues:
                    ++critiques === 1
                      ? [
                          {
                            slideIndex: 0,
                            slotId: first.slots[0]?.slotId,
                            category: 'factual-error',
                            message: 'Use the exact source wording',
                          },
                        ]
                      : [],
                });
              }
              if (role === 'rewriter') {
                repairs++;
                const slots = (input as { slots: { slotId: string }[] }).slots;
                return schema.parse({
                  rewrites: Object.fromEntries(
                    slots.map((s) => [s.slotId, ['Clear claim', 'Clear point', 'Clear action']]),
                  ),
                });
              }
              if (role !== 'writer') throw new Error(`Unexpected model role ${role}`);
              const index = (input as { index: number }).index;
              return schema.parse({
                patternId: pattern.patternId,
                textsBySlot: Object.fromEntries(
                  pattern.slots.map((s) => [s.slotId, `Claim ${String.fromCharCode(65 + index)}`]),
                ),
                speakerNotes: '',
              });
            },
          };
          const illustrations = await SharedIllustrations.load(
            {
              images: { model: 'forbidden-qr-image', generate: imageGenerate },
              text: provider,
              designSystem: profile.designSystem,
              seed: 42,
              signal,
            },
            registryDir,
          );
          const engine = new EngineClient({
            baseUrl: 'http://offline.test',
            fetchImpl: async (request, init) => {
              const path = String(request);
              const body = JSON.parse(String(init?.body)) as CompositionExportRequest;
              if (path.endsWith('/composition-check')) {
                checks.push(structuredClone(body));
                return Response.json({ schemaVersion: 1, findings: [] });
              }
              if (path.endsWith('/composition-audit')) {
                audits++;
                const findings =
                  audits === 1
                    ? [
                        {
                          schemaVersion: 1,
                          findingId: 'repair-qr-copy',
                          origin: 'deterministic',
                          confidence: 1,
                          fixability: 'assisted',
                          checkId: 'placeholder-text',
                          category: 'content',
                          severity: 'major',
                          title: 'Replace copy',
                          detail: 'Rewrite the first text slot',
                          target: {
                            slideId: 's1',
                            elementId: `slot-${first.slots[0]?.slotId}`,
                            variant,
                            box: null,
                          },
                          evidence: {
                            measured: 'before',
                            expected: 'after',
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
                  deckId: 'qr',
                  profile: 'composition',
                  passed: !findings.length,
                  score: 100,
                  slideCount: 10,
                  counts: { blocker: 0, major: findings.length, minor: 0, info: 0 },
                  categories: [],
                  findings,
                });
              }
              exports.push(structuredClone(body));
              const outputPath = join(outputDir, 'deck.pptx');
              const pdfPath = join(outputDir, 'deck.pdf');
              await writeFile(outputPath, 'offline-pptx');
              await writeFile(pdfPath, 'offline-pdf');
              return Response.json({
                ...fixture('CompositionExportResponse'),
                outputPath,
                pdfPath,
                previews: [],
              });
            },
          });
          const result = await generatePresentation({
            runId: `qr-${variant}`,
            templatePath: '/offline.pptx',
            outputDir,
            brief: JSON.stringify({ userRequirements: [{ text: `Use ${url}` }] }),
            slideCount: 10,
            profile,
            notes: [note],
            provider,
            illustrations: imagesConfigured ? illustrations : null,
            sharedPlan,
            variant,
            registryDir,
            engine,
            signal,
          });
          expect(repairs).toBeGreaterThanOrEqual(2);
          expect(exports).toHaveLength(2);
          const expected = { slotId: '3', fit: 'contain', purpose: 'qr' };
          for (const payload of [...checks, ...exports])
            for (const slide of payload.slides) expect(slide.images?.[0]).toMatchObject(expected);
          const saved = z
            .array(
              z.object({
                encodedUrl: z.string(),
                path: z.string(),
                sha256: z.string(),
                reachability: z.literal('not-checked'),
              }),
            )
            .parse(JSON.parse(await readFile(join(outputDir, 'qr-assets.json'), 'utf8')));
          expect(saved).toHaveLength(10);
          const asset = saved[0];
          if (!asset) throw new Error('Missing saved QR asset.');
          expect(saved.every((item) => item.encodedUrl === url && item.path === asset.path)).toBe(
            true,
          );
          expect(result.manifest.artifacts.some((item) => item.path === 'qr-assets.json')).toBe(
            true,
          );
          expect(result.manifest.revisions.find((item) => item.id === 'qr-encoding')).toMatchObject(
            { kind: 'config', version: '1.0.0' },
          );
          const finalPlan = JSON.parse(await readFile(join(outputDir, 'plan.json'), 'utf8')) as {
            slide: { images: unknown[] };
          }[];
          for (const slide of finalPlan) expect(slide.slide.images[0]).toMatchObject(expected);
          return { png: await readFile(join(outputDir, asset.path)), sha256: asset.sha256 };
        }),
      );
      expect(plannerCalls).toBe(1);
      expect(imageGenerate).not.toHaveBeenCalled();
      expect(new Set(results.map((result) => result.sha256)).size).toBe(1);
      expect(results[0]?.png.equals(results[1]?.png ?? Buffer.alloc(0))).toBe(true);
      expect(results[0]?.png.equals(results[2]?.png ?? Buffer.alloc(0))).toBe(true);
    },
  );
});
