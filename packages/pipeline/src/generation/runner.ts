import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { EngineClient } from '@lct/engine-client';
import { type LoadedAgent, loadAgent, toManifestEntry } from '@lct/registry';
import {
  artifactManifestSchema,
  finalReviewSchema,
  type CompositionNote,
  type DeckOutline,
  type GenerationProfile,
  type ImageSlot,
  type JobEvent,
  type JobStage,
  type StageTiming,
  type RunArtifact,
} from '@lct/contracts';
import { createMastra, closeMastra } from '../mastra.js';
import {
  createGenerationWorkflow,
  createRepairWorkflow,
  critiqueSchema,
  type DeckVariant,
  fitChars,
  type LayoutRemapPolicy,
  minChars,
  thinMessage,
  type SharedPlan,
  repairedSlideSchema,
  type repairTaskSchema,
  briefYears,
  type PlannedSlide,
  withCardHeadingProfile,
  writtenSchema,
} from './workflow.js';
import { deckRepeats, headlineSlot, slideFigureDefects } from './repeats.js';
import { approvedCoverage } from './final-review.js';
import { OpenAICompatibleProvider, RoutedTextProvider, type TextProvider } from './provider.js';
import { type Illustration, saveIllustration, type SharedIllustrations } from './illustrations.js';
import type { ModelProvider } from '../models/provider.js';
import { saveQrAssets } from './qr-assets.js';
import { reviewVariantVisually, type VisualReview } from './visual-review.js';
import {
  contextualCorrections,
  needsAttention,
  type SelfCheckRound,
  slideIndexOf,
} from './self-check.js';

type EventData = {
  [K in JobEvent['type']]: Omit<
    Extract<JobEvent, { type: K }>,
    'schemaVersion' | 'runId' | 'seq' | 'at'
  >;
}[JobEvent['type']];
/** Checks of the deterministic audit whose findings a rewrite of the slot's copy can fix. */
const REWRITABLE = new Set([
  'word-break',
  'placeholder-text',
  'bullet-length',
  'bullet-count',
  'text-clipped',
  'template-leftover',
]);

export interface GenerateOptions {
  runId: string;
  templatePath: string;
  outputDir: string;
  brief: string;
  slideCount: number | null;
  /** The approved outline; the planner lays out its slides instead of planning its own. */
  outline?: DeckOutline | null;
  outlineSource?: 'user' | 'model';
  profile: GenerationProfile;
  /** The template indexer's notes for this profile, if the template was indexed. */
  notes?: readonly CompositionNote[];
  registryDir: string;
  engine: EngineClient;
  provider: TextProvider;
  seed?: number;
  /** Which of the three renderings this run produces. Absent: balanced. */
  variant?: DeckVariant;
  /**
   * How this variant remaps the shared plan. Absent keeps the existing density choice.
   * `preserve-block-count` refuses a layout whose content-block count differs.
   */
  layoutRemapPolicy?: LayoutRemapPolicy;
  /** The plan shared by the variants of one brief, so it is made once. */
  sharedPlan?: SharedPlan;
  /** The day the deck is dated by. Absent: today. */
  today?: Date;
  /**
   * The pictures of the brief, shared by its three variants. Absent or null: no image model is
   * assigned, the planner is not offered compositions with a place for a picture.
   */
  illustrations?: SharedIllustrations | null;
  /**
   * The model that looks at the drawn slides and answers the content validation questions. Absent
   * or null: no model is assigned to the role, and the contextual audit is not part of the run.
   */
  reviewer?: { provider: ModelProvider; model: string } | null;
  /**
   * Absolute epoch ms when this variant must stop. Absent: this call's own deadline.
   * A later value is capped by that deadline, so preparation cannot buy another 290s.
   */
  deadlineAt?: number;
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => Promise<void>;
}

/** Time kept for export, audit and render after the pictures are awaited, in ms. */
const EXPORT_RESERVE_MS = 60_000;
/** The run's own deadline, under the five minutes the three variants share. */
const RUN_DEADLINE_MS = 290_000;
/** Time left for the manifest and the end of the run once the pictures of the slides are read. */
const REVIEW_RESERVE_MS = 12_000;
/** Under this the slides are not asked about: a review that cannot finish would only be thrown away. */
const REVIEW_MIN_MS = 8_000;

export class ContentFitError extends Error {
  readonly code = 'content-overflow';
  readonly requiresReview = true;
  constructor(readonly findings: readonly unknown[]) {
    super('Текст не помещается в шаблон после исправлений. Требуется проверка содержания.');
    this.name = 'ContentFitError';
  }
}

interface PendingPicture {
  index: number;
  slotId: string;
  ordinal: number;
  query: string;
  picture: Promise<Illustration | null>;
}

/** Image slots of a composition in reading order: top to bottom, then left to right. */
function orderedImageSlots(slots: readonly ImageSlot[]): ImageSlot[] {
  return [...slots].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}
/** The number a slide id ends with: `s3` and `imported-3` are both the third slide. */
function slideNumber(slideId: string): string {
  return /(\d+)$/.exec(slideId)?.[1] ?? slideId;
}

export async function generatePresentation(options: GenerateOptions) {
  const started = Date.now();
  const deadlineAt = Math.min(
    options.deadlineAt ?? started + RUN_DEADLINE_MS,
    started + RUN_DEADLINE_MS,
  );
  const remaining = deadlineAt - Date.now();
  const deadlineController = new AbortController();
  if (remaining <= 0) {
    deadlineController.abort(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );
  }
  const signal = AbortSignal.any([
    deadlineController.signal,
    AbortSignal.timeout(Math.max(0, remaining)),
    ...(options.signal ? [options.signal] : []),
  ]);
  let seq = 0;
  let events = Promise.resolve();
  let terminal = false;
  const timings: StageTiming[] = [];
  let stage: JobStage = 'planning';
  const emit = (data: EventData) => {
    if (terminal) return events;
    if (data.type === 'done' || data.type === 'failed') terminal = true;
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
  // A card heading the template placed highest reads as a heading everywhere: in the plan, the
  // writer, the critic and the repair.
  const profile = withCardHeadingProfile(options.profile);
  // One date for the whole run: the writer and the audit judge years by the same day.
  const today = options.today ?? new Date();
  const sourceBrief =
    options.outline && options.outlineSource !== 'model'
      ? JSON.stringify({ brief: options.brief, approvedOutline: options.outline })
      : options.brief;
  let ownedMastra: ReturnType<typeof createMastra> | undefined;
  try {
    signal.throwIfAborted();
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
    // Pictures are asked for as soon as the plan is laid out, and drawn while the copy is written.
    const illustrations = options.illustrations ?? null;
    const pending: PendingPicture[] = [];
    let illustratingStarted = 0;
    const onPlan = (slides: readonly PlannedSlide[]) => {
      if (!illustrations) return;
      for (const slide of slides) {
        const frames = orderedImageSlots(slide.composition.imageSlots ?? []);
        frames.forEach((frame, ordinal) => {
          pending.push({
            index: slide.index,
            slotId: frame.slotId,
            ordinal,
            query: slide.imageQuery,
            picture: illustrations.request({
              index: slide.index,
              ordinal,
              count: frames.length,
              imageQuery: slide.imageQuery,
              purpose: slide.purpose,
              deck: { title: slide.title, audience: slide.audience, goal: slide.goal },
              box: frame.box,
            }),
          });
        });
      }
      if (!pending.length) return;
      illustratingStarted = Date.now();
      void emit({ type: 'stage-started', stage: 'illustrating' });
      let drawn = 0;
      for (const item of pending)
        void item.picture.then(() =>
          emit({
            type: 'stage-progress',
            stage: 'illustrating',
            done: ++drawn,
            total: pending.length,
            note: 'Нарисована иллюстрация',
          }),
        );
    };
    let qrImages = new Map<number, NonNullable<z.infer<typeof writtenSchema>['slide']['images']>>();
    const workflow = createGenerationWorkflow({
      provider: options.provider,
      plannerInstructions: planner.instructions,
      writerInstructions: writer.instructions,
      repairInstructions: rewriter.instructions,
      variant: options.variant ?? 'balanced',
      ...(options.layoutRemapPolicy ? { layoutRemapPolicy: options.layoutRemapPolicy } : {}),
      ...(options.sharedPlan ? { sharedPlan: options.sharedPlan } : {}),
      today,
      imagesAvailable: illustrations !== null,
      outlineIsSource: options.outlineSource !== 'model',
      onPlan,
      qrSourceBrief: sourceBrief,
      onQrPlan: async (slides) => {
        const assets = await saveQrAssets(
          options.outputDir,
          slides,
          new Map((options.notes ?? []).map((note) => [note.patternId, note])),
          sourceBrief,
          signal,
        );
        qrImages = assets.images;
      },
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
      today,
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
    ownedMastra = mastra;
    const run = await mastra.getWorkflow('generation').createRun();
    const result = await run.start({
      inputData: {
        brief: sourceBrief,
        slideCount: options.slideCount,
        profile,
        outline: options.outline ?? null,
      },
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
    for (const current of written) {
      const images = qrImages.get(current.index);
      if (images?.length) current.slide = { ...current.slide, images };
    }
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
      // The local day, as the writer dates the deck; toISOString would give the UTC one.
      today: [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-'),
      briefYears: briefYears(sourceBrief),
    });
    // Geometry cannot authorize deleting content or restoring an older, unaudited wording.
    const settleFit = async () => {
      const { findings } = await options.engine.checkCompositions(exportRequest(), signal);
      // A torn word goes to the rewriter and the audit, but never costs the variant: a deck with
      // one ugly line is worth more than none, and the three are all required.
      const errors = findings.filter((f) => f.severity === 'error' && f.code !== 'word-break');
      if (errors.length) throw new ContentFitError(errors);
    };
    let contentRevision = 1;
    let previousHash = '';
    const contentHash = () => {
      const next = createHash('sha256').update(JSON.stringify(written)).digest('hex');
      if (previousHash && previousHash !== next) contentRevision++;
      previousHash = next;
      return next;
    };
    const critiqueInput = () => ({
      brief: sourceBrief,
      approvedOutline: options.outlineSource === 'model' ? null : (options.outline ?? null),
      proposedOutline: options.outlineSource === 'model' ? (options.outline ?? null) : null,
      contentHash: contentHash(),
      contentRevision,
      slides: written.map((s) => {
        const pattern = profile.compositions.find((p) => p.patternId === s.slide.patternId);
        const headline = pattern ? headlineSlot(pattern) : undefined;
        return {
          slideIndex: s.index,
          approvedSlide:
            options.outlineSource === 'model'
              ? null
              : (s.approvedSlide ?? options.outline?.slides[s.index] ?? null),
          patternId: s.slide.patternId,
          speakerNotes: s.slide.speakerNotes,
          visual: s.slide.visual ?? null,
          texts: s.slide.texts
            .filter((t) => t.slotId !== s.slide.visual?.slotId)
            .map((t) => {
              const slot = pattern?.slots.find((item) => item.slotId === t.slotId);
              return {
                ...t,
                role: slot?.role === 'title' && slot.slotId !== headline ? 'heading' : slot?.role,
                sample: slot?.sample,
                maxChars: slot?.maxChars,
                fitChars: slot ? fitChars(slot) : undefined,
              };
            }),
        };
      }),
    });
    const critiqueCurrent = () =>
      options.provider.generate(
        'critic',
        critic.instructions,
        critiqueInput(),
        critiqueSchema,
        signal,
      );
    const auditHistory = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const [fit, critique] = await Promise.all([
        options.engine.checkCompositions(exportRequest(), signal),
        critiqueCurrent(),
      ]);
      // Slides are written one by one, so a figure or a title repeated across the deck is seen
      // only here, over all of them.
      const deck = written.flatMap((s) => {
        const composition = profile.compositions.find((p) => p.patternId === s.slide.patternId);
        return composition ? [{ ...s, composition }] : [];
      });
      // Defects code sees for certain, whatever the critic said: a figure or a title repeated
      // across the deck, a figure said twice on one slide or missing from the source, and a text
      // block too thin for its box, which leaves the slide looking empty.
      const variant = options.variant ?? 'balanced';
      const repeats = [
        ...deckRepeats(written[0]?.title ?? '', deck, sourceBrief),
        ...slideFigureDefects(deck, sourceBrief),
        ...deck.flatMap((s) =>
          s.composition.slots.flatMap((slot) => {
            const least = minChars(slot, variant);
            const text = s.slide.texts.find((t) => t.slotId === slot.slotId)?.text.trim() ?? '';
            return least && text && text.length < least && slot.slotId !== s.slide.visual?.slotId
              ? [
                  {
                    slideIndex: s.index,
                    slotId: slot.slotId,
                    category: 'incomplete-text' as const,
                    message: thinMessage(text.length, least, fitChars(slot)),
                  },
                ]
              : [];
          }),
        ),
      ];
      auditHistory.push({
        attempt,
        contentRevision,
        contentHash: contentHash(),
        fit: fit.findings,
        critique: critique.issues,
        repeats,
      });
      // A card heading is a short name; a critic asking it for a claim would have the rewriter
      // turn every card into a sentence.
      const namesAHeading = (issue: (typeof critique.issues)[number]) => {
        if (issue.category !== 'label-title') return false;
        const slide = written.find((s) => s.index === issue.slideIndex);
        const pattern = profile.compositions.find((p) => p.patternId === slide?.slide.patternId);
        return pattern !== undefined && headlineSlot(pattern) !== issue.slotId;
      };
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
          .filter((i) => i.category !== 'style' && !namesAHeading(i))
          .flatMap((issue) =>
            issue.slotId
              .split(/[\s,;]+/)
              .filter(Boolean)
              .map((slotId) => ({ ...issue, slotId })),
          ),
        ...repeats,
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
        for (const issue of [...critique.issues.filter((i) => !namesAHeading(i)), ...repeats]) {
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
        const pattern = profile.compositions.find((p) => p.patternId === current.slide.patternId);
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
          brief: sourceBrief,
          ...(current.approvedSlide ? { approvedSlide: current.approvedSlide } : {}),
          purpose: current.purpose,
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
        if (current) current.slide = { ...update.slide, images: current.slide.images };
      }
    }
    await writeFile(join(options.outputDir, 'audit.json'), JSON.stringify(auditHistory, null, 2));
    timings.push({ stage, ms: Date.now() - auditStarted });
    await emit({ type: 'stage-finished', stage, durationMs: Date.now() - auditStarted });
    // The pictures get what is left of the budget but the export; one that is not ready by then
    // leaves its slot, and the export removes the empty frame.
    const images: Record<string, unknown>[] = [];
    if (pending.length) {
      const waitMs = Math.max(0, deadlineAt - Date.now() - EXPORT_RESERVE_MS);
      const deadline = new Promise<'late'>((resolve) => {
        const timer = setTimeout(() => resolve('late'), waitMs);
        timer.unref?.();
      });
      const settled = await Promise.all(
        pending.map(async (item) => ({
          item,
          picture: await Promise.race([item.picture, deadline]),
        })),
      );
      for (const { item, picture } of settled) {
        const current = written.find((s) => s.index === item.index);
        const base = { slide: item.index, slotId: item.slotId, query: item.query };
        if (picture === 'late' || picture === null || !current) {
          images.push({ ...base, status: picture === 'late' ? 'timed-out' : 'failed' });
          continue;
        }
        const path = await saveIllustration(options.outputDir, item.index, item.ordinal, picture);
        current.slide = {
          ...current.slide,
          images: [
            ...(current.slide.images ?? []),
            { slotId: item.slotId, path, fit: 'cover' as const },
          ],
        };
        images.push({
          ...base,
          status: 'generated',
          path,
          model: picture.model,
          prompt: picture.prompt,
          seed: picture.seed,
          size: picture.size,
        });
      }
      const drawnMs = Date.now() - illustratingStarted;
      timings.push({ stage: 'illustrating', ms: drawnMs });
      await emit({ type: 'stage-finished', stage: 'illustrating', durationMs: drawnMs });
      const missing = images.filter((image) => image.status !== 'generated').length;
      if (missing)
        await emit({
          type: 'warning',
          stage: 'illustrating',
          code: 'images-missing',
          message:
            `Не нарисовано иллюстраций: ${missing} из ${images.length}. ` +
            'Их слоты убраны со слайдов, пустых рамок нет.',
        });
    }
    await writeFile(join(options.outputDir, 'plan.json'), JSON.stringify(written, null, 2));
    await writeFile(join(options.outputDir, 'images.json'), JSON.stringify(images, null, 2));
    stage = 'exporting';
    const exportStarted = Date.now();
    await emit({ type: 'stage-started', stage });
    await settleFit();
    let output = await options.engine.exportCompositions(exportRequest(), signal);
    signal.throwIfAborted();
    // The written file goes through the deterministic audit. Problems in a slot's copy that a
    // rewrite can fix (filler text, overlong bullets, too many points) go back to the slot
    // rewriter once, then the deck is written and audited again. The report is kept either way.
    let report = await options.engine.auditCompositions(exportRequest(), signal);
    // The picture of the slides is asked about as soon as the deck is written, so what it shows can
    // go to the rewriter with what the measuring audit found. A review that fails or does not fit
    // the time left never costs the variant; the user is told.
    let contextual: VisualReview | null = null;
    let reviewerAgent: LoadedAgent | null = null;
    let reviewerAgentId = '';
    // An empty import is slideCount 0 with no reviews, and 0 < 0 does not catch it.
    // The picture audit is finished only when that count is the written deck.
    const reviewedDeck = (review: VisualReview | null): review is VisualReview =>
      review !== null &&
      review.failures.length === 0 &&
      review.reviews.length >= review.slideCount &&
      review.slideCount === written.length &&
      review.slideCount > 0;
    const reviewPictures = async (
      only?: ReadonlySet<number>,
      previous?: VisualReview,
      reserveMs = EXPORT_RESERVE_MS,
    ): Promise<VisualReview | null> => {
      if (!options.reviewer) return null;
      const left = deadlineAt - Date.now() - reserveMs;
      if (left < REVIEW_MIN_MS) {
        await emit({
          type: 'warning',
          stage,
          code: 'contextual-audit-skipped',
          message: 'Смысловой аудит по картинкам слайдов пропущен: не осталось времени.',
        });
        return null;
      }
      const stop = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      try {
        const reviewer = (reviewerAgent ??= await loadAgent(
          join(options.registryDir, 'slide-reviewer'),
        ));
        reviewerAgentId = `${reviewer.config.id}@${reviewer.config.version}`;
        // The review has its own stop: when its time is up the requests still in flight are
        // cancelled, so they neither hold the model's slots nor write after the run is done.
        const expired = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            stop.abort(new Error('time is up'));
            reject(new Error('time is up'));
          }, left);
        });
        const asked = reviewVariantVisually({
          engine: options.engine,
          agent: reviewer,
          provider: options.reviewer.provider,
          brief: options.brief,
          goal: written[0]?.title ?? '',
          pptxPath: output.outputPath,
          mediaDir: join(options.outputDir, 'media'),
          previews: output.previews,
          seed: options.seed ?? 42,
          outputDir: options.outputDir,
          variant: options.variant ?? 'balanced',
          ...(only ? { only } : {}),
          ...(previous ? { previous } : {}),
          signal: AbortSignal.any([signal, stop.signal]),
        });
        // Once the race is lost nobody awaits it: its late failure must not go unhandled.
        asked.catch(() => undefined);
        return await Promise.race([asked, expired]);
      } catch (error) {
        signal.throwIfAborted();
        await emit({
          type: 'warning',
          stage,
          code: 'contextual-audit-failed',
          message:
            'Смысловой аудит по картинкам слайдов не выполнен: ' +
            (error instanceof Error ? error.message : String(error)),
        });
        return null;
      } finally {
        clearTimeout(timer);
        stop.abort();
      }
    };
    contextual = await reviewPictures();
    const foundBefore = {
      deterministic: needsAttention(report.findings).length,
      contextual: contextual ? needsAttention(contextual.findings).length : 0,
    };
    const selfCheck: SelfCheckRound[] = [];
    const fixable = (r: typeof report) =>
      r.findings.filter(
        (f) =>
          REWRITABLE.has(f.checkId) &&
          (f.severity === 'blocker' || f.severity === 'major') &&
          f.target.elementId?.startsWith('slot-'),
      );
    // What goes back to the rewriter: the measuring audit's findings on slots, and what the
    // picture of the slides showed that new wording can answer. One round, inside the time.
    const requested = [
      ...fixable(report).flatMap((f) => {
        const index = slideIndexOf(f.target.slideId);
        return index === null
          ? []
          : [
              {
                index,
                slotId: (f.target.elementId ?? '').slice('slot-'.length),
                message: `${f.title}: ${f.detail} (${f.evidence.measured}; ${f.evidence.expected})`,
                source: 'deterministic' as const,
              },
            ];
      }),
      ...(contextual
        ? contextualCorrections(contextual.findings, written).map((c) => ({
            ...c,
            source: 'contextual' as const,
          }))
        : []),
    ];
    if (requested.length > 0) {
      const tasks: z.infer<typeof repairTaskSchema>[] = [];
      for (const current of written) {
        const corrections = requested
          .filter((r) => r.index === current.index)
          .map(({ slotId, message }) => ({ slotId, message }));
        const pattern = profile.compositions.find((p) => p.patternId === current.slide.patternId);
        if (corrections.length && pattern) {
          tasks.push({
            index: current.index,
            brief: sourceBrief,
            ...(current.approvedSlide ? { approvedSlide: current.approvedSlide } : {}),
            purpose: current.purpose,
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
            if (current) current.slide = { ...update.slide, images: current.slide.images };
          }
          await settleFit();
          output = await options.engine.exportCompositions(exportRequest(), signal);
          report = await options.engine.auditCompositions(exportRequest(), signal);
          // The slides that were rewritten are asked about again, from the new picture.
          const rewritten = new Set(tasks.map((task) => task.index + 1));
          if (contextual) {
            contextual = await reviewPictures(rewritten, contextual, REVIEW_RESERVE_MS);
          }
          selfCheck.push({
            round: 1,
            found: foundBefore,
            corrected: requested
              .filter((r) => rewritten.has(r.index + 1))
              .map((r) => ({ slide: r.index + 1, slotId: r.slotId, source: r.source })),
            after: reviewedDeck(contextual)
              ? {
                  deterministic: needsAttention(report.findings).length,
                  contextual: needsAttention(contextual.findings).length,
                }
              : null,
          });
        }
      }
    }
    for (const finding of report.findings.filter(
      (f) => f.severity === 'blocker' || f.severity === 'major',
    )) {
      const message = `Аудит, слайд ${slideNumber(finding.target.slideId)}: ${finding.title}`;
      reviewWarnings.push(message);
      await emit({ type: 'warning', stage, code: 'content-review-required', message });
    }
    const finalContentHash = contentHash();
    await writeFile(
      join(options.outputDir, 'audit-deterministic.json'),
      JSON.stringify({ ...report, contentRevision, contentHash: finalContentHash }, null, 2),
    );
    if (contextual !== null) {
      await writeFile(
        join(options.outputDir, 'audit-contextual.json'),
        JSON.stringify(
          {
            contentRevision,
            contentHash: finalContentHash,
            model: options.reviewer?.model ?? '',
            agent: reviewerAgentId,
            slides: contextual.slideCount,
            pictures: contextual.pictures,
            findings: contextual.findings,
            failures: contextual.failures,
            reviews: contextual.reviews,
          },
          null,
          2,
        ),
      );
    }
    // The final semantic check runs after every possible copy mutation and describes the export.
    const finalCritique = await critiqueCurrent();
    const coverage = approvedCoverage(options.outline, written, finalCritique.coverage);
    const semanticErrors = finalCritique.issues.filter((i) => i.category !== 'style');
    const deterministicErrors = report.findings.filter(
      (f) => f.severity === 'blocker' || f.severity === 'major',
    ).length;
    // What the pictures of the slides showed counts here too, or a deck with a blocker in its
    // picture would be called complete and recommended.
    const pictured = (contextual?.findings ?? []).filter((f) => f.origin === 'contextual');
    const pictureErrors = pictured.filter(
      (f) => f.severity === 'blocker' || f.severity === 'major',
    ).length;
    const pictureWarnings = pictured.filter((f) => f.severity === 'minor').length;
    const finalReview = finalReviewSchema.parse({
      schemaVersion: 1,
      contentRevision,
      contentHash: contentHash(),
      status: reviewedDeck(contextual)
        ? semanticErrors.length || deterministicErrors || pictureErrors || coverage.missing.length
          ? 'requires-review'
          : 'complete'
        : 'unknown',
      deterministic: {
        errors: deterministicErrors,
        warnings: report.findings.length - deterministicErrors,
      },
      contextual: {
        errors: semanticErrors.length + pictureErrors,
        warnings: finalCritique.issues.length - semanticErrors.length + pictureWarnings,
      },
      coverage,
      issues: finalCritique.issues,
      errors: deterministicErrors + semanticErrors.length + pictureErrors + coverage.missing.length,
      warnings:
        report.findings.length -
        deterministicErrors +
        finalCritique.issues.length -
        semanticErrors.length +
        pictureWarnings,
    });
    for (const missing of coverage.missing) {
      const message = `Слайд ${missing.slideIndex + 1}: не подтверждено сохранение утверждения «${missing.text}».`;
      reviewWarnings.push(message);
      await warn(message);
    }
    if (semanticErrors.length) {
      const message = `Итоговая смысловая проверка: замечаний ${semanticErrors.length}. Требуется проверка.`;
      reviewWarnings.push(message);
      await warn(message);
    }
    auditHistory.push({
      attempt: auditHistory.length,
      contentRevision,
      contentHash: contentHash(),
      fit: [],
      critique: finalCritique.issues,
      repeats: [],
    });
    await writeFile(join(options.outputDir, 'audit.json'), JSON.stringify(auditHistory, null, 2));
    await writeFile(join(options.outputDir, 'plan.json'), JSON.stringify(written, null, 2));
    await writeFile(
      join(options.outputDir, 'final-review.json'),
      JSON.stringify(finalReview, null, 2),
    );
    signal.throwIfAborted();
    // What the final picture of the slides still shows, once the self-check has had its round.
    if (contextual) {
      for (const failure of contextual.failures) {
        await emit({
          type: 'warning',
          stage,
          code: 'contextual-audit-failed',
          message: `Смысловой аудит, слайд ${slideNumber(failure.slideId)}: ответ модели не получен.`,
        });
      }
      for (const finding of needsAttention(contextual.findings)) {
        const message = `Смысловой аудит, слайд ${slideNumber(finding.target.slideId)}: ${finding.title}`;
        reviewWarnings.push(message);
        await emit({ type: 'warning', stage, code: 'content-review-required', message });
      }
    }
    if (!options.reviewer) {
      await emit({
        type: 'warning',
        stage,
        code: 'contextual-audit-skipped',
        message:
          'Смысловой аудит по картинкам слайдов не выполнен: роли «Визуальная проверка» не назначена модель.',
      });
    }
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
    // What the self-check found, sent back and found again, for the user and for the pitch.
    await writeFile(
      join(options.outputDir, 'self-check.json'),
      JSON.stringify(
        {
          pictureReviewed: reviewedDeck(contextual),
          rounds: selfCheck,
          remaining: {
            deterministic: needsAttention(report.findings).length,
            contextual: contextual ? needsAttention(contextual.findings).length : 0,
          },
        },
        null,
        2,
      ),
    );
    timings.push({ stage, ms: Date.now() - exportStarted });
    await emit({ type: 'stage-finished', stage, durationMs: Date.now() - exportStarted });
    const deck = {
      runId: options.runId,
      variant: options.variant ?? 'balanced',
      title: written[0]?.title ?? 'Презентация',
      designSystem: options.profile.designSystem,
      templateIr: output.templateIr,
      warnings: [...output.warnings, ...reviewWarnings],
      imagesMocked: illustrations === null,
    };
    await writeFile(join(options.outputDir, 'deck.json'), JSON.stringify(deck));
    const artifacts: RunArtifact[] = [];
    for (const [kind, path] of [
      ['pptx', output.outputPath],
      ['pdf', output.pdfPath],
      ['deck-plan', join(options.outputDir, 'plan.json')],
      ['audit', join(options.outputDir, 'audit.json')],
      ['audit', join(options.outputDir, 'audit-deterministic.json')],
      ['audit', join(options.outputDir, 'final-review.json')],
      ...(contextual ? [['audit', join(options.outputDir, 'audit-contextual.json')] as const] : []),
      ['audit', join(options.outputDir, 'self-check.json')],
      ['audit', join(options.outputDir, 'qr-assets.json')],
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
      contentPackId: createHash('sha256').update(sourceBrief).digest('hex'),
      planId: options.runId,
      contentRevision,
      contentHash: contentHash(),
      seed: options.seed ?? 42,
      revisions: [
        planner,
        writer,
        critic,
        rewriter,
        ...(illustrations ? [illustrations.agent] : []),
        ...(contextual && reviewerAgent ? [reviewerAgent] : []),
      ]
        .map((agent) => ({
          kind: 'agent',
          id: agent.config.id,
          version: agent.config.version,
          hash: toManifestEntry(agent).instructionsSha256,
        }))
        .concat([
          {
            kind: 'config',
            id: 'layout-remap-policy',
            version: '1.0.0',
            hash: createHash('sha256')
              .update(options.layoutRemapPolicy ?? 'density')
              .digest('hex'),
          },
          {
            kind: 'config',
            id: 'qr-encoding',
            version: '1.0.0',
            hash: createHash('sha256')
              .update(
                JSON.stringify({
                  encoder: 'qrcode@1.5.4',
                  mode: 'byte',
                  encoding: 'UTF-8',
                  errorCorrectionLevel: 'M',
                  margin: 4,
                  scale: 8,
                }),
              )
              .digest('hex'),
          },
          {
            kind: 'model',
            id: options.provider.model,
            version: 'hosted-revision-not-reported',
            hash: createHash('sha256').update(options.provider.model).digest('hex'),
          },
          // The image model as the server names it; a hosted one does not report its weights.
          ...(illustrations
            ? [
                {
                  kind: 'model',
                  id: illustrations.model,
                  version: 'hosted-revision-not-reported',
                  hash: createHash('sha256').update(illustrations.model).digest('hex'),
                },
              ]
            : []),
          // The model that read the pictures of the slides.
          ...(contextual && options.reviewer
            ? [
                {
                  kind: 'model',
                  id: options.reviewer.model,
                  version: 'hosted-revision-not-reported',
                  hash: createHash('sha256').update(options.reviewer.model).digest('hex'),
                },
              ]
            : []),
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
    await closeMastra(mastra);
    ownedMastra = undefined;
    await writeFile(join(options.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    signal.throwIfAborted();
    await emit({ type: 'done', totalMs: Date.now() - started, manifestPath: 'manifest.json' });
    return { deck, output, manifest };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.';
    await writeFile(
      join(options.outputDir, 'failure.json'),
      JSON.stringify({
        message,
        elapsedMs: Date.now() - started,
        ...(error instanceof ContentFitError
          ? { requiresReview: true, code: error.code, findings: error.findings }
          : {}),
      }),
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
  } finally {
    if (ownedMastra) await closeMastra(ownedMastra);
  }
}
