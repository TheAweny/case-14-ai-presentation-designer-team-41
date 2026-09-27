import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AuditReport,
  DeckExportRequest,
  DeckPlan,
  JobStage,
  LayoutVariantsRequest,
  LayoutVariantsResponse,
  ModelEntry,
  SlideIr,
} from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import type { LoadedAgent } from '@lct/registry';
import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '../models/provider.js';
import { buildContentPack } from '../planner/content-pack.js';
import { generateDeck, GenerateDeckError } from './generate-deck.js';

const pack = buildContentPack({
  briefId: 'brief-1',
  goal: 'Show the pilot worked.',
  language: 'en',
  documents: [{ text: 'Retention rose to 94%.' }],
});

const plan: DeckPlan = {
  schemaVersion: 1,
  planId: 'plan-1',
  briefId: 'brief-1',
  title: 'Pilot',
  language: 'en',
  slides: [
    {
      slideId: 's1',
      intent: 'title',
      headline: 'The pilot worked',
      subhead: '',
      blocks: [],
      speakerNotes: '',
      sources: [],
    },
    {
      slideId: 's2',
      intent: 'statement',
      headline: 'Retention rose to 94%',
      subhead: '',
      blocks: [{ kind: 'paragraph', text: 'Retention rose to 94%.' }],
      speakerNotes: '',
      sources: [],
    },
  ],
};

const model: ModelEntry = {
  id: 'fake',
  repo: 'lct26/recorded-responses',
  revision: 'v1',
  license: 'Apache-2.0',
  sizeB: 1,
  type: 'llm',
  provider: 'fake',
  baseUrlEnv: 'LLM_BASE_URL',
};

function agent(id: string, outputSchema: string): LoadedAgent {
  return {
    config: {
      id,
      version: '1.0.0',
      description: id,
      modelId: 'fake',
      generation: { temperature: 0, topP: 1, maxOutputTokens: 1024 },
      outputSchema,
      instructionsFile: 'instructions.md',
    },
    instructions: `${id} prompt`,
    directory: id,
  };
}

const planner: ModelProvider = {
  name: 'fake',
  complete: () => Promise.resolve(JSON.stringify(plan)),
};
const brokenReviewer: ModelProvider = {
  name: 'fake',
  complete: () => Promise.reject(new Error('down')),
};

function slide(variant: 'dense' | 'airy'): SlideIr {
  return {
    schemaVersion: 1,
    slideId: 's1',
    variant,
    index: 0,
    patternId: 'title',
    slideCx: 100,
    slideCy: 100,
    elements: [],
  };
}

const TEMPLATE_HASH = 'a'.repeat(64);

function engine(
  failAt?: 'layouts' | 'exportDeck',
): EngineClient & { exports: DeckExportRequest[] } {
  const exports: DeckExportRequest[] = [];
  const fake = {
    exports,
    layouts: (request: LayoutVariantsRequest): Promise<LayoutVariantsResponse> => {
      if (failAt === 'layouts') return Promise.reject(new Error('template unreadable'));
      return Promise.resolve({
        schemaVersion: 1,
        designSystem: { templateHash: TEMPLATE_HASH } as LayoutVariantsResponse['designSystem'],
        patternCatalog: {
          schemaVersion: 1,
          templateHash: TEMPLATE_HASH,
          patterns: [],
        } as unknown as LayoutVariantsResponse['patternCatalog'],
        variants: (request.variants ?? []).map((variant) => ({
          variant,
          slides: [slide(variant as 'dense')],
        })),
      });
    },
    audit: (): Promise<AuditReport> =>
      Promise.resolve({
        schemaVersion: 1,
        deckId: 'd',
        profile: 'default',
        passed: true,
        score: 100,
        slideCount: 1,
        counts: { blocker: 0, major: 0, minor: 0, info: 0 },
        categories: [],
        findings: [],
      }),
    exportDeck: async (request: DeckExportRequest) => {
      exports.push(request);
      if (failAt === 'exportDeck') throw new Error('no LibreOffice');
      const path = join(request.outputDir, `${request.variant}.pptx`);
      await writeFile(path, 'pptx');
      return {
        schemaVersion: 1 as const,
        variant: request.variant,
        files: [{ format: 'pptx' as const, path }],
      };
    },
  };
  return fake as unknown as EngineClient & { exports: DeckExportRequest[] };
}

async function run(options: { failAt?: 'layouts' | 'exportDeck'; reviewer?: boolean } = {}) {
  const runDir = await mkdtemp(join(tmpdir(), 'run-'));
  const stages: JobStage[] = [];
  const result = await generateDeck({
    runId: 'run-1',
    runDir,
    templatePath: '/tmp/template.pptx',
    pack,
    slideCount: 2,
    variants: ['dense', 'airy'],
    auditProfile: 'default',
    seed: 7,
    engine: engine(options.failAt),
    planner: { agent: agent('deck-planner', 'DeckPlan'), provider: planner, model },
    ...(options.reviewer
      ? {
          reviewer: {
            agent: agent('slide-reviewer', 'SlideReview'),
            provider: brokenReviewer,
            model,
          },
        }
      : {}),
    onStage: (stage) => stages.push(stage),
  });
  return { result, runDir, stages };
}

describe('generateDeck', () => {
  it('plans once, lays out every variant, audits and exports them', async () => {
    const { result, stages } = await run();
    expect(stages).toEqual(['planning', 'laying-out', 'auditing', 'exporting']);
    expect(result.variants.map((v) => v.variant)).toEqual(['dense', 'airy']);
    expect(result.variants.every((v) => v.files.length === 1)).toBe(true);
    expect(result.groundingProblems).toEqual([]);
  });

  it('writes a manifest with the files, their hashes and the stage timings', async () => {
    const { result, runDir } = await run();
    const written = JSON.parse(
      await readFile(join(runDir, 'manifest.json'), 'utf8'),
    ) as typeof result.manifest;
    expect(written).toEqual(result.manifest);
    expect(written.planId).toBe('plan-1');
    expect(written.templateHash).toBe(TEMPLATE_HASH);
    expect(written.timings.map((t) => t.stage)).toEqual([
      'planning',
      'laying-out',
      'auditing',
      'exporting',
    ]);
    const kinds = written.artifacts.map((a) => `${a.kind}:${a.variant ?? '-'}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'deck-plan:-',
        'slide-ir:dense',
        'audit:airy',
        'pptx:dense',
        'pptx:airy',
      ]),
    );
    expect(written.revisions.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['agent', 'prompt', 'model', 'template']),
    );
  });

  it('records a reviewer failure as a warning and still delivers the decks', async () => {
    const { result } = await run({ reviewer: true });
    expect(result.warnings.some((w) => w.includes('down'))).toBe(true);
    expect(result.variants).toHaveLength(2);
  });

  it('stops at the stage that failed and names it', async () => {
    await expect(run({ failAt: 'layouts' })).rejects.toMatchObject({ stage: 'laying-out' });
    await expect(run({ failAt: 'exportDeck' })).rejects.toBeInstanceOf(GenerateDeckError);
  });
});
