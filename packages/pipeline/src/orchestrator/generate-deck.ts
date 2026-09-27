import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  artifactManifestSchema,
  type ArtifactManifest,
  type AuditFinding,
  type AuditReport,
  type ComponentRevision,
  type ContentPack,
  type DeckPlan,
  type JobStage,
  type LayoutVariant,
  type ModelEntry,
  type RunArtifact,
  type SlideIr,
  type StageTiming,
} from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import type { LoadedAgent } from '@lct/registry';
import { runContextualAudit } from '../audit/contextual-audit.js';
import type { ModelProvider } from '../models/provider.js';
import { planDeck } from '../planner/plan-deck.js';
import { findOverflows, fitCopy } from '../writer/fit-copy.js';
import type { GroundingProblem } from '../planner/grounding.js';

/** An agent with the provider and the catalogue entry of the model it runs on. */
export interface BoundAgent {
  readonly agent: LoadedAgent;
  readonly provider: ModelProvider;
  readonly model: ModelEntry;
}

export interface GenerateDeckOptions {
  readonly runId: string;
  readonly runDir: string;
  readonly templatePath: string;
  readonly pack: ContentPack;
  readonly slideCount: number;
  readonly variants: readonly LayoutVariant[];
  readonly auditProfile: string;
  readonly seed: number;
  readonly engine: EngineClient;
  readonly planner: BoundAgent;
  /** Without it the contextual half of the audit is skipped, and the manifest says so. */
  readonly reviewer?: BoundAgent;
  /** Shortens what overflows, once. Without it overflow is only reported. */
  readonly writer?: BoundAgent;
  /** Configuration files the run was made from, recorded in the manifest by hash. */
  readonly configFiles?: readonly string[];
  readonly onStage?: (stage: JobStage, note: string) => void;
}

export interface VariantResult {
  readonly variant: LayoutVariant;
  readonly slides: SlideIr[];
  readonly audit: AuditReport;
  readonly contextual: AuditFinding[];
  readonly files: string[];
}

export interface GenerateDeckResult {
  readonly plan: DeckPlan;
  readonly groundingProblems: readonly GroundingProblem[];
  readonly variants: VariantResult[];
  readonly manifest: ArtifactManifest;
  /** Parts of the run that failed without stopping it, such as a slide that could not be reviewed. */
  readonly warnings: string[];
}

/** A stage failed and the run stopped there. */
export class GenerateDeckError extends Error {
  constructor(
    readonly stage: JobStage,
    cause: unknown,
  ) {
    super(`${stage} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'GenerateDeckError';
  }
}

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function artifact(
  runDir: string,
  path: string,
  kind: RunArtifact['kind'],
  variant: LayoutVariant | null,
): Promise<RunArtifact> {
  const bytes = await readFile(path);
  return {
    kind,
    variant,
    path: relative(runDir, path),
    bytes: (await stat(path)).size,
    sha256: sha256(bytes),
  };
}

function agentRevisions(bound: BoundAgent): ComponentRevision[] {
  const { agent, model } = bound;
  return [
    {
      kind: 'agent',
      id: agent.config.id,
      version: agent.config.version,
      hash: sha256(JSON.stringify(agent.config)),
    },
    {
      kind: 'prompt',
      id: agent.config.id,
      version: agent.config.version,
      hash: sha256(agent.instructions),
    },
    {
      kind: 'model',
      id: model.id,
      version: model.revision,
      hash: sha256(`${model.repo}@${model.revision}`),
    },
  ];
}

/**
 * One run from a template and a content pack to decks on disk, in a single local process.
 *
 * The plan is made once and every variant is laid out from it. The variants are then audited,
 * deterministically by the engine and contextually by the reviewer agent, and exported in
 * parallel. Every stage is timed against the five minute budget, every file is recorded with its
 * hash, and the manifest names each agent, prompt, model revision and config that took part.
 *
 * Failure is bounded: a stage that cannot produce its output stops the run with the stage named,
 * while a slide the reviewer could not answer for is recorded as a warning and the run goes on.
 */
export async function generateDeck(options: GenerateDeckOptions): Promise<GenerateDeckResult> {
  const runDir = resolve(options.runDir);
  await mkdir(runDir, { recursive: true });
  const startedAt = new Date();
  const timings: StageTiming[] = [];
  const artifacts: RunArtifact[] = [];
  const warnings: string[] = [];

  async function stage<T>(name: JobStage, note: string, work: () => Promise<T>): Promise<T> {
    options.onStage?.(name, note);
    const started = Date.now();
    try {
      return await work();
    } catch (error) {
      throw new GenerateDeckError(name, error);
    } finally {
      timings.push({ stage: name, ms: Date.now() - started });
    }
  }

  const { plan, problems } = await stage('planning', 'план колоды', async () => {
    const result = await planDeck({
      pack: options.pack,
      slideCount: options.slideCount,
      agent: options.planner.agent,
      provider: options.planner.provider,
      seed: options.seed,
    });
    const path = join(runDir, 'plan.json');
    await writeJson(path, result.plan);
    artifacts.push(await artifact(runDir, path, 'deck-plan', null));
    return result;
  });
  for (const problem of problems) {
    warnings.push(`plan ${problem.slideId ?? ''}: ${problem.message}`.trim());
  }

  const layOut = (deck: DeckPlan) =>
    options.engine.layouts({
      schemaVersion: 1,
      templatePath: options.templatePath,
      plan: deck,
      variants: [...options.variants],
    });
  let deckPlan = plan;
  let layouts = await stage('laying-out', 'три варианта вёрстки', () => layOut(deckPlan));

  const targets = findOverflows(deckPlan, layouts.variants);
  if (options.writer && targets.length > 0) {
    const writer = options.writer;
    layouts = await stage(
      'laying-out',
      `сокращение ${targets.length} текстов и повторная вёрстка`,
      async () => {
        const fitted = await fitCopy({
          plan: deckPlan,
          targets,
          agent: writer.agent,
          provider: writer.provider,
          seed: options.seed,
        });
        for (const reason of fitted.rejected) warnings.push(`copy ${reason}`);
        if (fitted.applied === 0) return layouts;
        deckPlan = fitted.plan;
        await writeJson(join(runDir, 'plan.json'), deckPlan);
        return layOut(deckPlan);
      },
    );
  }
  const left = findOverflows(deckPlan, layouts.variants).length;
  if (left > 0) warnings.push(`${left} текстов всё ещё не влезают в свои рамки`);

  const variants = await stage('auditing', 'детерминированный и контекстный аудит', () =>
    Promise.all(
      layouts.variants.map(async ({ variant, slides }) => {
        const slidesPath = join(runDir, `slides-${variant}.json`);
        await writeJson(slidesPath, slides);
        artifacts.push(await artifact(runDir, slidesPath, 'slide-ir', variant));
        const [audit, contextual] = await Promise.all([
          options.engine.audit({
            schemaVersion: 1,
            deckId: `${options.runId}-${variant}`,
            slides,
            designSystem: layouts.designSystem,
            patternCatalog: layouts.patternCatalog,
            profile: options.auditProfile,
          }),
          options.reviewer
            ? runContextualAudit({
                slides,
                pack: options.pack,
                agent: options.reviewer.agent,
                provider: options.reviewer.provider,
                seed: options.seed,
              })
            : Promise.resolve({ findings: [], reviews: [], failures: [] }),
        ]);
        for (const failure of contextual.failures) {
          warnings.push(`review ${variant}/${failure.slideId}: ${failure.error}`);
        }
        const auditPath = join(runDir, `audit-${variant}.json`);
        await writeJson(auditPath, {
          ...audit,
          findings: [...audit.findings, ...contextual.findings],
        });
        artifacts.push(await artifact(runDir, auditPath, 'audit', variant));
        return { variant, slides, audit, contextual: contextual.findings };
      }),
    ),
  );

  const exported = await stage('exporting', 'PPTX и PDF', () =>
    Promise.all(
      variants.map(async (result) => {
        const response = await options.engine.exportDeck({
          schemaVersion: 1,
          templatePath: options.templatePath,
          variant: result.variant,
          slides: result.slides,
          outputDir: runDir,
        });
        for (const file of response.files) {
          artifacts.push(await artifact(runDir, file.path, file.format, result.variant));
        }
        return { ...result, files: response.files.map((file) => file.path) };
      }),
    ),
  );

  const revisions: ComponentRevision[] = [
    ...agentRevisions(options.planner),
    ...(options.reviewer ? agentRevisions(options.reviewer) : []),
    ...(options.writer ? agentRevisions(options.writer) : []),
    {
      kind: 'template',
      id: options.templatePath.split('/').at(-1) ?? options.templatePath,
      version: layouts.designSystem.templateHash.slice(0, 12),
      hash: layouts.designSystem.templateHash,
    },
  ];
  for (const file of options.configFiles ?? []) {
    revisions.push({ kind: 'config', id: file, version: '1', hash: sha256(await readFile(file)) });
  }
  const finishedAt = new Date();
  const manifest = artifactManifestSchema.parse({
    schemaVersion: 1,
    runId: options.runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    templateHash: layouts.designSystem.templateHash,
    contentPackId: options.pack.packId,
    planId: deckPlan.planId,
    seed: options.seed,
    revisions,
    modelCalls: [options.planner, options.writer, options.reviewer]
      .filter((bound): bound is BoundAgent => bound !== undefined)
      .flatMap((bound) => {
        const spent = bound.provider.usage?.get(bound.agent.config.id);
        return spent ? [{ agentId: bound.agent.config.id, modelId: bound.model.id, ...spent }] : [];
      }),
    artifacts,
    timings,
    totalMs: finishedAt.getTime() - startedAt.getTime(),
    appliedPatchIds: [],
  });
  await writeJson(join(runDir, 'manifest.json'), manifest);
  return { plan: deckPlan, groundingProblems: problems, variants: exported, manifest, warnings };
}
