import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { EngineClient } from '@lct/engine-client';
import { loadAgent, toManifestEntry } from '@lct/registry';
import {
  artifactManifestSchema,
  type CompositionNote,
  type GenerationProfile,
  type JobEvent,
  type JobStage,
  type StageTiming,
  type RunArtifact,
} from '@lct/contracts';
import { createMastra } from '../mastra.js';
import {
  createGenerationWorkflow,
  createRepairWorkflow,
  critiqueSchema,
  type DeckVariant,
  fitChars,
  type SharedPlan,
  repairedSlideSchema,
  type repairTaskSchema,
  writtenSchema,
} from './workflow.js';
import { OpenAICompatibleProvider, RoutedTextProvider, type TextProvider } from './provider.js';

type EventData = {
  [K in JobEvent['type']]: Omit<
    Extract<JobEvent, { type: K }>,
    'schemaVersion' | 'runId' | 'seq' | 'at'
  >;
}[JobEvent['type']];
/** Checks of the deterministic audit whose findings a rewrite of the slot's copy can fix. */
const REWRITABLE = new Set(['placeholder-text', 'bullet-length', 'bullet-count', 'text-clipped']);

export interface GenerateOptions {
  runId: string;
  templatePath: string;
  outputDir: string;
  brief: string;
  slideCount: number | null;
  profile: GenerationProfile;
  /** The template indexer's notes for this profile, if the template was indexed. */
  notes?: readonly CompositionNote[];
  registryDir: string;
  engine: EngineClient;
  provider: TextProvider;
  seed?: number;
  /** Which of the three renderings this run produces. Absent: balanced. */
  variant?: DeckVariant;
  /** The plan shared by the variants of one brief, so it is made once. */
  sharedPlan?: SharedPlan;
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => Promise<void>;
}
export async function generatePresentation(options: GenerateOptions) {
  const started = Date.now();
  const signal = AbortSignal.any([
    AbortSignal.timeout(290000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let seq = 0;
  let events = Promise.resolve();
  const timings: StageTiming[] = [];
  let stage: JobStage = 'planning';
  const emit = (data: EventData) => {
    const event = {
      ...data,
      schemaVersion: 1 as const,
      runId: options.runId,
      seq: seq++,
      at: new Date().toISOString(),
    } as JobEvent;
    events = events.then(() => options.onEvent?.(event));
    return events;
  };
  await mkdir(options.outputDir, { recursive: true });
  try {
    // Warnings collected from repairs and audits; recorded in the deck and streamed as events.
    const reviewWarnings: string[] = [];
    const warn = (message: string) =>
      emit({ type: 'warning', stage, code: 'content-review-required', message });
    const planner = await loadAgent(join(options.registryDir, 'deck-planner'));
    const writer = await loadAgent(join(options.registryDir, 'slide-writer'));
    const rewriter = await loadAgent(join(options.registryDir, 'slot-rewriter'));
    const critic = await loadAgent(join(options.registryDir, 'deck-critic'));
    if (
      options.provider instanceof OpenAICompatibleProvider ||
      options.provider instanceof RoutedTextProvider
    ) {
      for (const [role, agent] of [
        ['planner', planner],
        ['writer', writer],
        ['critic', critic],
        ['rewriter', rewriter],
      ] as const) {
        options.provider.setAgentGeneration(role, agent.config.generation);
      }
    }
    await emit({ type: 'stage-started', stage });
    const workflow = createGenerationWorkflow({
      provider: options.provider,
      plannerInstructions: planner.instructions,
      writerInstructions: writer.instructions,
      repairInstructions: rewriter.instructions,
      variant: options.variant ?? 'balanced',
      ...(options.sharedPlan ? { sharedPlan: options.sharedPlan } : {}),
      signal,
      concurrency: 3,
      ...(options.notes ? { notes: options.notes } : {}),
      onProgress: async (done, total) =>
        emit({
          type: 'stage-progress',
          stage: 'planning',
          done,
          total,
          note: 'Подготовлено содержание слайда',
        }),
      onWarning: async (message) => {
        reviewWarnings.push(message);
        await warn(message);
      },
    });
    const repairWorkflow = createRepairWorkflow({
      provider: options.provider,
      plannerInstructions: planner.instructions,
      writerInstructions: writer.instructions,
      repairInstructions: rewriter.instructions,
      variant: options.variant ?? 'balanced',
      signal,
      concurrency: 3,
      onWarning: async (message) => {
        reviewWarnings.push(message);
        await warn(message);
      },
    });
    const mastra = createMastra({
      storageUrl: `file:${join(options.outputDir, 'mastra.db')}`,
      generationWorkflow: workflow,
      repairWorkflow,
    });
    const run = await mastra.getWorkflow('generation').createRun();
    const result = await run.start({
      inputData: { brief: options.brief, slideCount: options.slideCount, profile: options.profile },
    });
    if (result.status !== 'success')
      throw new Error(
        result.status === 'failed' ? result.error.message : `Workflow ${result.status}`,
      );
    signal.throwIfAborted();
    const written = z
      .array(writtenSchema)
      .parse(result.result)
      .sort((a, b) => a.index - b.index);
    timings.push({ stage, ms: Date.now() - started });
    await emit({ type: 'stage-finished', stage, durationMs: timings[0]?.ms ?? 0 });
    stage = 'auditing';
    const auditStarted = Date.now();
    await emit({ type: 'stage-started', stage });
    const exportRequest = () => ({
      schemaVersion: 1 as const,
      templatePath: options.templatePath,
      outputPath: join(options.outputDir, 'deck.pptx'),
      slides: written.map((s) => s.slide),
    });
    const auditHistory = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const [fit, critique] = await Promise.all([
        options.engine.checkCompositions(exportRequest(), signal),
        options.provider.generate(
          'critic',
          critic.instructions,
          {
            brief: options.brief,
            slides: written.map((s) => {
              const pattern = options.profile.compositions.find(
                (p) => p.patternId === s.slide.patternId,
              );
              return {
                slideIndex: s.index,
                patternId: s.slide.patternId,
                speakerNotes: s.slide.speakerNotes,
                // The slot a table or chart replaced has no text on purpose; the critic sees the
                // visual instead.
                visual: s.slide.visual ?? null,
                texts: s.slide.texts
                  .filter((t) => t.slotId !== s.slide.visual?.slotId)
                  .map((t) => {
                    const slot = pattern?.slots.find((item) => item.slotId === t.slotId);
                    return {
                      ...t,
                      role: slot?.role,
                      sample: slot?.sample,
                      maxChars: slot?.maxChars,
                      fitChars: slot ? fitChars(slot) : undefined,
                    };
                  }),
              };
            }),
          },
          critiqueSchema,
          signal,
        ),
      ]);
      auditHistory.push({ attempt, fit: fit.findings, critique: critique.issues });
      await writeFile(join(options.outputDir, 'audit.json'), JSON.stringify(auditHistory, null, 2));
      await writeFile(join(options.outputDir, 'plan.json'), JSON.stringify(written, null, 2));
      const issues = [
        ...fit.findings.map((f) => ({
          ...f,
          message: `${f.message} Maximum ${f.maxChars} characters, ${f.maxLines} lines.`,
        })),
        // A critic that names several slots in one issue ("6,8") gets one issue per slot:
        // the repair addresses slots by id, and a joined id would silently match none.
        ...critique.issues
          .filter((i) => i.category !== 'style')
          .flatMap((issue) =>
            issue.slotId
              .split(/[\s,;]+/)
              .filter(Boolean)
              .map((slotId) => ({ ...issue, slotId })),
          ),
      ];
      if (!issues.length) break;
      if (attempt === 2) {
        // The bounded repair could not cure every defect, yet the deck is still produced: the
        // remaining findings become warnings. Three variants are mandatory, so a stuck quality
        // gate must not drop one of them.
        for (const finding of fit.findings) {
          const message =
            `Слайд ${finding.slideIndex + 1}, ${finding.slotId}: ${finding.message} ` +
            `Maximum ${finding.maxChars} characters, ${finding.maxLines} lines.`;
          reviewWarnings.push(message);
          await emit({ type: 'warning', stage, code: 'content-review-required', message });
        }
        for (const issue of critique.issues) {
          const message = `Слайд ${issue.slideIndex + 1}, поле ${issue.slotId}: ${issue.message}`;
          reviewWarnings.push(message);
          await emit({ type: 'warning', stage, code: 'content-review-required', message });
        }
        break;
      }
      const tasks: z.infer<typeof repairTaskSchema>[] = [];
      for (const current of written) {
        const corrections = issues.filter((i) => i.slideIndex === current.index);
        if (!corrections.length) continue;
        const pattern = options.profile.compositions.find(
          (p) => p.patternId === current.slide.patternId,
        );
        if (!pattern) throw new Error('Missing composition during repair.');
        const composition = {
          ...pattern,
          slots: pattern.slots.map((slot) => {
            const finding = fit.findings.find(
              (f) => f.slideIndex === current.index && f.slotId === slot.slotId,
            );
            return finding
              ? { ...slot, maxChars: Math.min(slot.maxChars, finding.maxChars) }
              : slot;
          }),
        };
        tasks.push({
          index: current.index,
          brief: options.brief,
          composition,
          previous: current.slide,
          corrections,
        });
      }
      if (!tasks.length) {
        // The critic named slides the deck does not have: report the issues and finish instead
        // of failing the variant, which would leave the user with fewer than three decks.
        for (const issue of issues) {
          const message = `Слайд ${issue.slideIndex + 1}, поле ${issue.slotId}: ${issue.message}`;
          reviewWarnings.push(message);
          await emit({ type: 'warning', stage, code: 'content-review-required', message });
        }
        break;
      }
      const repairRun = await mastra.getWorkflow('repair').createRun();
      const repaired = await repairRun.start({ inputData: tasks });
      if (repaired.status !== 'success') {
        // A failed repair keeps the previous copy: the run goes on with a warning instead of
        // failing, so the variant still reaches the export with the other two.
        const message =
          repaired.status === 'failed'
            ? repaired.error.message
            : `Repair workflow ${repaired.status}`;
        reviewWarnings.push(message);
        await emit({ type: 'warning', stage, code: 'content-review-required', message });
        continue;
      }
      for (const update of z.array(repairedSlideSchema).parse(repaired.result)) {
        const current = written.find((s) => s.index === update.index);
        if (current) current.slide = update.slide;
      }
    }
    await writeFile(join(options.outputDir, 'audit.json'), JSON.stringify(auditHistory, null, 2));
    timings.push({ stage, ms: Date.now() - auditStarted });
    await emit({ type: 'stage-finished', stage, durationMs: Date.now() - auditStarted });
    const images = written
      .filter((s) => s.imageQuery)
      .map((s) => ({
        slide: s.index,
        query: s.imageQuery,
        provider: 'mock',
        status: 'not-generated',
      }));
    await emit({
      type: 'warning',
      stage: 'laying-out',
      code: 'images-mocked',
      message: 'Генерация иллюстраций пока отключена; сохранено оформление шаблона.',
    });
    await writeFile(join(options.outputDir, 'plan.json'), JSON.stringify(written, null, 2));
    await writeFile(join(options.outputDir, 'images.json'), JSON.stringify(images, null, 2));
    stage = 'exporting';
    const exportStarted = Date.now();
    await emit({ type: 'stage-started', stage });
    let output = await options.engine.exportCompositions(exportRequest(), signal);
    signal.throwIfAborted();
    // The written file goes through the deterministic audit. Problems in a slot's copy that a
    // rewrite can fix (filler text, overlong bullets, too many points) go back to the slot
    // rewriter once, then the deck is written and audited again. The report is kept either way.
    let report = await options.engine.auditCompositions(exportRequest(), signal);
    const fixable = (r: typeof report) =>
      r.findings.filter(
        (f) =>
          REWRITABLE.has(f.checkId) &&
          (f.severity === 'blocker' || f.severity === 'major') &&
          f.target.elementId?.startsWith('slot-'),
      );
    if (fixable(report).length > 0) {
      const tasks: z.infer<typeof repairTaskSchema>[] = [];
      for (const current of written) {
        const slideId = `s${current.index + 1}`;
        const corrections = fixable(report)
          .filter((f) => f.target.slideId === slideId)
          .map((f) => ({
            slotId: (f.target.elementId ?? '').slice('slot-'.length),
            message: `${f.title}: ${f.detail} (${f.evidence.measured}; ${f.evidence.expected})`,
          }));
        const pattern = options.profile.compositions.find(
          (p) => p.patternId === current.slide.patternId,
        );
        if (corrections.length && pattern) {
          tasks.push({
            index: current.index,
            brief: options.brief,
            composition: pattern,
            previous: current.slide,
            corrections,
          });
        }
      }
      if (tasks.length) {
        const repairRun = await mastra.getWorkflow('repair').createRun();
        const repaired = await repairRun.start({ inputData: tasks });
        if (repaired.status === 'success') {
          for (const update of z.array(repairedSlideSchema).parse(repaired.result)) {
            const current = written.find((s) => s.index === update.index);
            if (current) current.slide = update.slide;
          }
          output = await options.engine.exportCompositions(exportRequest(), signal);
          report = await options.engine.auditCompositions(exportRequest(), signal);
        }
      }
    }
    for (const finding of report.findings.filter(
      (f) => f.severity === 'blocker' || f.severity === 'major',
    )) {
      const message = `Аудит, слайд ${finding.target.slideId.slice(1)}: ${finding.title}`;
      reviewWarnings.push(message);
      await emit({ type: 'warning', stage, code: 'content-review-required', message });
    }
    await writeFile(
      join(options.outputDir, 'audit-deterministic.json'),
      JSON.stringify(report, null, 2),
    );
    signal.throwIfAborted();
    if (output.missingFonts.length > 0) {
      const fonts = output.missingFonts.join(', ');
      await emit({
        type: 'warning',
        stage: 'exporting',
        code: 'fonts-substituted',
        message:
          `Шрифтов шаблона нет на сервере: ${fonts}. ` +
          'В .pptx они сохранены, превью нарисованы запасным шрифтом.',
      });
    }
    timings.push({ stage, ms: Date.now() - exportStarted });
    await emit({ type: 'stage-finished', stage, durationMs: Date.now() - exportStarted });
    const deck = {
      runId: options.runId,
      variant: options.variant ?? 'balanced',
      title: written[0]?.title ?? 'Презентация',
      designSystem: options.profile.designSystem,
      templateIr: output.templateIr,
      warnings: [...output.warnings, ...reviewWarnings],
      imagesMocked: true,
    };
    await writeFile(join(options.outputDir, 'deck.json'), JSON.stringify(deck));
    const artifacts: RunArtifact[] = [];
    for (const [kind, path] of [
      ['pptx', output.outputPath],
      ['pdf', output.pdfPath],
      ['deck-plan', join(options.outputDir, 'plan.json')],
      ['audit', join(options.outputDir, 'audit.json')],
      ['audit', join(options.outputDir, 'audit-deterministic.json')],
      ...output.previews.map((p) => ['preview', p]),
    ] as const) {
      const bytes = await readFile(path);
      artifacts.push({
        kind: kind as RunArtifact['kind'],
        path: relative(options.outputDir, path),
        variant: options.variant ?? 'balanced',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    const manifest = artifactManifestSchema.parse({
      schemaVersion: 1,
      runId: options.runId,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      templateHash: options.profile.templateHash,
      contentPackId: createHash('sha256').update(options.brief).digest('hex'),
      planId: options.runId,
      seed: options.seed ?? 42,
      revisions: [planner, writer, critic, rewriter]
        .map((agent) => ({
          kind: 'agent',
          id: agent.config.id,
          version: agent.config.version,
          hash: toManifestEntry(agent).instructionsSha256,
        }))
        .concat([
          {
            kind: 'model',
            id: options.provider.model,
            version: 'hosted-revision-not-reported',
            hash: createHash('sha256').update(options.provider.model).digest('hex'),
          },
        ]),
      modelCalls:
        options.provider instanceof OpenAICompatibleProvider
          ? options.provider.calls.map((call) => ({
              agentId: call.agent,
              modelId: options.provider.model,
              calls: 1,
              inputTokens: call.inputTokens,
              outputTokens: call.outputTokens,
            }))
          : [],
      artifacts,
      timings,
      totalMs: Date.now() - started,
      appliedPatchIds: [],
    });
    await writeFile(join(options.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    signal.throwIfAborted();
    await emit({ type: 'done', totalMs: Date.now() - started, manifestPath: 'manifest.json' });
    return { deck, output, manifest };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.';
    await writeFile(
      join(options.outputDir, 'failure.json'),
      JSON.stringify({ message, elapsedMs: Date.now() - started }),
    );
    await emit({
      type: 'failed',
      stage,
      code: signal.aborted
        ? 'budget-exceeded'
        : message.includes('Model API')
          ? 'model-unavailable'
          : 'internal',
      message,
      retryable: true,
    });
    throw error;
  }
}
