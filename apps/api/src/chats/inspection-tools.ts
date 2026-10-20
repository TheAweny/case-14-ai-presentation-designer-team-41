import { basename, dirname, join } from 'node:path';
import {
  compositionCheckResponseSchema,
  generationProfileSchema,
  type CompositionExportRequest,
  type EditorSnapshotLoad,
} from '@lct/contracts';
import type { ChatTool, ToolContext } from '@lct/pipeline';
import { auditSlide } from '@lct/slide-audit';
import { RUN_STATES } from '@lct/run-store';
import { z } from 'zod';
import type { Account } from '../accounts/account-rules.js';
import { checkContentCoverage } from './content-coverage.js';
import { chatDecks, type ChatToolScope } from './chat-tools.js';
import {
  readSavedOutlineFacts,
  readInspectionSlide,
  inspectionProvenance,
  readInspectionDesignSystem,
  readSnapshotPreview,
  DeckInspectionError,
  readSavedPreview,
  readSavedRequest,
  canonicalPlanHash,
} from './deck-inspection.js';

const MAX_RESULT_CHARS = 10_000;
const MAX_ERROR_CHARS = 2_000;
const MODES = ['chat', 'plan', 'auto'] as const;

export interface InspectionGeneration {
  directory(id: string): string;
  isRunning(runId: string): boolean;
  library: { visible(id: string, ownerId?: string): Promise<boolean> };
  repository: { get(runId: string): Promise<{ state: string } | null> };
  template(
    id: string,
    account: Account,
  ): Promise<{
    storage_path: string;
    profile: { generation?: unknown };
  }>;
  engine: {
    checkCompositions(request: CompositionExportRequest, signal?: AbortSignal): Promise<unknown>;
  };
}

export interface InspectionDependency {
  loadSnapshot(deckId: string, account: Account): Promise<EditorSnapshotLoad>;
}

const deckInput = z.object({
  deckId: z.string().min(1),
  slideIndex: z.number().int().positive(),
  source: z.enum(['saved', 'original']).default('saved'),
  expectedRevision: z.number().int().nonnegative().optional(),
  expectedContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

const fitInput = deckInput.extend({
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(10).default(5),
});

const buildInput = z.object({ buildId: z.string().uuid() });

const runStateSchema = z.object({ state: z.enum(RUN_STATES) });

function bounded(output: unknown): unknown {
  if (JSON.stringify(output).length >= MAX_RESULT_CHARS) {
    fail('Finding row exceeds 10000 characters.');
  }
  return output;
}

function fail(message: string): never {
  throw new Error(message.slice(0, MAX_ERROR_CHARS));
}

function boundedError(error: string | null): string | null {
  return error === null || error.length <= MAX_ERROR_CHARS
    ? error
    : error.slice(0, MAX_ERROR_CHARS);
}

export function inspectionTools(
  generation: InspectionGeneration,
  scope: ChatToolScope,
  inspection?: InspectionDependency,
): ChatTool[] {
  const account = scope.account;

  function deckRoot(deckId: string): string {
    const directory = generation.directory(deckId);
    if (basename(directory) !== deckId) fail('The deck directory is not named for this run.');
    return dirname(directory);
  }

  async function ownFinishedDeck(deckId: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (!chatDecks(scope.messages()).has(deckId)) fail('This deck was not built in this chat.');
    signal.throwIfAborted();
    if (!(await generation.library.visible(deckId, account.id))) {
      fail('This deck was not built in this chat.');
    }
    signal.throwIfAborted();
    const record = await generation.repository.get(deckId);
    signal.throwIfAborted();
    const state = runStateSchema.safeParse(record);
    if (!state.success || state.data.state !== 'done') fail('The saved deck is not finished.');
    signal.throwIfAborted();
    return deckRoot(deckId);
  }

  const previewSlide: ChatTool = {
    name: 'preview_slide',
    input: deckInput,
    modes: MODES,
    async run(input, context: ToolContext) {
      context.signal.throwIfAborted();
      const request = deckInput.parse(input);
      const root = await ownFinishedDeck(request.deckId, context.signal);
      context.signal.throwIfAborted();
      const ref = { root, deckId: request.deckId, slideIndex: request.slideIndex };
      const { read, assertCurrent } = await readInspectionSlide(
        ref,
        request,
        inspection ? () => inspection.loadSnapshot(request.deckId, account) : undefined,
      );
      context.signal.throwIfAborted();
      let preview: unknown;
      if (read.source === 'server-snapshot') {
        preview = await readSnapshotPreview(ref, read);
      } else {
        try {
          const original = await readSavedPreview(ref);
          if (original.contentHash !== read.contentHash)
            throw new DeckInspectionError(
              'stale_revision',
              'Original plan changed during preview.',
            );
          preview = { ...original, status: 'rendered' };
        } catch (error) {
          if (!(error instanceof DeckInspectionError) || error.code === 'stale_revision')
            throw error;
          preview = { status: 'not-rendered', reason: error.code, visionAssessment: false };
        }
      }
      await assertCurrent();
      context.signal.throwIfAborted();
      return {
        output: bounded({
          ...(preview as object),
          ...inspectionProvenance(read),
          cacheKey: `preview:${account.id}:${read.cacheKey}:${canonicalPlanHash(preview)}`,
        }),
      };
    },
  };

  const checkSlideFit: ChatTool = {
    name: 'check_slide_fit',
    input: fitInput,
    modes: MODES,
    async run(input, context: ToolContext) {
      context.signal.throwIfAborted();
      const request = fitInput.parse(input);
      const root = await ownFinishedDeck(request.deckId, context.signal);
      const ref = { root, deckId: request.deckId, slideIndex: request.slideIndex };
      context.signal.throwIfAborted();
      const { read, assertCurrent } = await readInspectionSlide(
        ref,
        request,
        inspection ? () => inspection.loadSnapshot(request.deckId, account) : undefined,
      );
      context.signal.throwIfAborted();
      if (read.source === 'server-snapshot') {
        let designSystem = await readInspectionDesignSystem(ref);
        if (!designSystem) {
          const saved = await readSavedRequest(ref);
          const template = await generation.template(saved.templateId, account);
          const profile = generationProfileSchema.safeParse(template.profile.generation);
          designSystem = profile.success ? profile.data.designSystem : null;
        }
        context.signal.throwIfAborted();
        // The layout's recorded overflow predates editor text changes. It is not a fresh measurement.
        const slide = {
          ...read.slide,
          elements: read.slide.elements.map((element) =>
            element.kind === 'text' ? { ...element, overflow: null } : element,
          ),
        };
        const issues = designSystem ? auditSlide(slide, { designSystem }) : [];
        const findings = issues
          .slice(request.offset, request.offset + request.limit)
          .map((issue) => ({ ...issue, slideIndex: request.slideIndex - 1 }));
        const next = request.offset + findings.length;
        await assertCurrent();
        context.signal.throwIfAborted();
        return {
          output: bounded({
            ...inspectionProvenance(read),
            slideIndex: request.slideIndex,
            slideId: read.slide.slideId,
            cacheKey: `fit:${account.id}:${read.cacheKey}:${canonicalPlanHash(designSystem)}:${request.offset}:${request.limit}`,
            status: 'unknown',
            textFit: 'unknown',
            reason: designSystem
              ? 'No fresh font measurements for saved text; recorded overflow is excluded.'
              : 'No design system for snapshot audit.',
            auditScope: 'SlideIR without text measurement or render',
            offset: request.offset,
            nextOffset: next < issues.length ? next : null,
            totalFindings: issues.length,
            findings,
          }),
        };
      }
      const slide = read.slide;
      const saved = await readSavedRequest(ref);
      context.signal.throwIfAborted();
      const template = await generation.template(saved.templateId, account);
      context.signal.throwIfAborted();
      if (!generationProfileSchema.safeParse(template.profile.generation).success) {
        fail('The template has no generation profile.');
      }
      const check = compositionCheckResponseSchema.parse(
        await generation.engine.checkCompositions(
          {
            schemaVersion: 1,
            templatePath: template.storage_path,
            outputPath: join(generation.directory(request.deckId), 'inspection-unused.pptx'),
            slides: [slide],
          },
          context.signal,
        ),
      );
      context.signal.throwIfAborted();
      if (check.findings.some((finding) => finding.slideIndex !== 0)) {
        fail('The engine measured a slide that was not requested.');
      }
      const measured = check.findings.map((finding) => ({
        ...finding,
        slideIndex: request.slideIndex - 1,
      }));
      await assertCurrent();
      context.signal.throwIfAborted();
      const findings = measured.slice(request.offset, request.offset + request.limit);
      const next = request.offset + findings.length;
      return {
        output: bounded({
          ...inspectionProvenance(read),
          cacheKey: `fit:${account.id}:${read.cacheKey}:${canonicalPlanHash(template.profile.generation)}:${request.offset}:${request.limit}`,
          slideIndex: request.slideIndex,
          offset: request.offset,
          nextOffset: next < measured.length ? next : null,
          totalFindings: measured.length,
          findings,
        }),
      };
    },
  };

  const checkContentCoverageTool: ChatTool = {
    name: 'check_content_coverage',
    input: deckInput,
    modes: MODES,
    async run(input, context: ToolContext) {
      context.signal.throwIfAborted();
      const request = deckInput.parse(input);
      const root = await ownFinishedDeck(request.deckId, context.signal);
      const ref = { root, deckId: request.deckId, slideIndex: request.slideIndex };
      context.signal.throwIfAborted();
      const { read, assertCurrent } = await readInspectionSlide(
        ref,
        request,
        inspection ? () => inspection.loadSnapshot(request.deckId, account) : undefined,
      );
      context.signal.throwIfAborted();
      // Snapshot position is not lineage after reordering. Only the generated/imported stable
      // identities have a known original ordinal; new editor slide identities do not.
      const originalNumber =
        read.source === 'original'
          ? request.slideIndex
          : Number(/^(?:imported-|s)([1-9]\d*)$/.exec(read.slide.slideId)?.[1] ?? 0);
      const facts =
        originalNumber > 0
          ? await readSavedOutlineFacts({ ...ref, slideIndex: originalNumber })
          : [];
      context.signal.throwIfAborted();
      const report =
        facts.length === 0
          ? {
              status: 'unknown',
              reason:
                originalNumber > 0 ? 'no approved requirements' : 'unknown original slide identity',
              sourceFactChecking: false,
            }
          : checkContentCoverage(facts, read.slide);
      await assertCurrent();
      context.signal.throwIfAborted();
      return {
        output: bounded({
          ...report,
          ...inspectionProvenance(read),
          slideIndex: request.slideIndex,
          cacheKey: `coverage:${account.id}:${read.cacheKey}:${canonicalPlanHash(facts)}`,
          requirementsSlideIndex: originalNumber || null,
          evidenceScope:
            'literal text in saved content; no semantic, source or rendered visibility assessment',
          ...(read.source === 'server-snapshot' ? { slideId: read.slide.slideId } : {}),
        }),
      };
    },
  };

  const readBuildStatus: ChatTool = {
    name: 'read_build_status',
    input: buildInput,
    modes: MODES,
    async run(input, context: ToolContext) {
      context.signal.throwIfAborted();
      const request = buildInput.parse(input);
      context.signal.throwIfAborted();
      const part = scope
        .messages()
        .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
        .find((item) => item.type === 'build' && item.buildId === request.buildId);
      if (!part || part.type !== 'build') fail('This build is not in this chat.');
      if (part.variantRunIds.length > 3) fail('A build has at most three variants.');
      for (const runId of part.variantRunIds) {
        context.signal.throwIfAborted();
        if (!(await generation.library.visible(runId, account.id))) {
          fail('This build is not in this chat.');
        }
        context.signal.throwIfAborted();
      }
      const variants = [];
      for (const runId of part.variantRunIds) {
        context.signal.throwIfAborted();
        const record = await generation.repository.get(runId);
        context.signal.throwIfAborted();
        const state = record === null ? null : runStateSchema.parse(record).state;
        variants.push({ runId, state, running: generation.isRunning(runId) });
      }
      return {
        output: {
          buildId: part.buildId,
          status: part.status,
          error: boundedError(part.error),
          variants,
        },
      };
    },
  };

  return [previewSlide, checkSlideFit, checkContentCoverageTool, readBuildStatus];
}
