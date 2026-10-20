import {
  BadRequestException,
  ConflictException,
  Inject,
  Optional,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile, cp, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import {
  compositionPlanSchema,
  brandbookBindingSchema,
  generationProfileSchema,
  generationRequestSchema,
  generationSpecSchema,
  generationUsageSchema,
  layoutVariantSchema,
  modelRefSchema,
  storedTemplateIndexSchema,
  type CompositionPlan,
  type GenerationProfile,
  type GenerationRequest,
  type LayoutVariant,
  type ModelRef,
  type StoredTemplateIndex,
  type ChatToolActivity,
  type ReasoningCapability,
  type JobEvent,
  type BrandbookBinding,
} from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import {
  currentTemplateIndexRevision,
  templateIndexState,
  generatePresentation,
  VisionProvider,
  GenerationProvider,
  indexTemplateWithAgent,
  RoutedTextProvider,
  SharedPlan,
  SharedContent,
  CheckpointTextProvider,
  SemanticTextProvider,
  tokenPriceResolver,
  TaskCheckpoints,
  dependencyKey,
  atomicJson,
  ledgerFetch,
  SharedIllustrations,
  OpenAICompatibleImageProvider,
  FakeImageProvider,
  AttemptBudget,
  type ImageProvider,
  type IndexProgress,
} from '@lct/pipeline';
import {
  BUILD_DEADLINE_MS,
  buildStopReason,
  openBuildBudget,
  waitForBuild,
} from './build-budget.js';
import { effectiveModelPlan } from './model-plan.js';
import { loadAnswerFormat } from '@lct/registry';
import {
  GenerationBuildStore,
  AccountUsageStore,
  BuildConflictError,
  PostgresProviderLedger,
  type BuildRecord,
  type BuildLease,
  type RunRepository,
} from '@lct/run-store';
import {
  ModelNotConfiguredError,
  ModelSettingsService,
  type ResolvedModel,
} from '../models/model-settings.service.js';
import { ModelCapabilityService } from '../models/model-capabilities.js';
import { RUN_REPOSITORY } from '../runs/runs.tokens.js';
import { LibraryMetadata } from './library-metadata.js';
import type { Account } from '../accounts/account-rules.js';
import { visibleFile } from '../files/template-visibility.js';
import { readPreparedMaterial } from '../materials/prepared-material.js';
import { AccountUsageService, directoryBytes } from '../accounts/account-usage.service.js';

/** The account as model settings see it: whose connections and role choices apply. */
export function actorOf(account: Account) {
  return { userId: account.id, admin: account.role === 'admin' };
}

/** Width of a sample slide picture in the library: sharp in a card, light on the page. */
const TEMPLATE_PREVIEW_WIDTH = 640;

/** A preparation under way: reading the template's profile, then describing its compositions. */
export interface PrepareProgress {
  stage: 'profile' | 'index';
  described: number;
  total: number;
}

/** The renderings of every brief, generated in parallel. */
export const VARIANTS = ['dense', 'balanced', 'airy'] as const satisfies readonly LayoutVariant[];

/** A build the service started: its runs, and how each ended once all have. */
export interface StartedBuild {
  readonly runId: string;
  readonly variants: readonly { readonly variant: LayoutVariant; readonly runId: string }[];
  /** How each variant ended, one promise per variant. */
  readonly each: readonly Promise<VariantEnd>[];
  readonly settled: Promise<readonly VariantEnd[]>;
}

export interface VariantEnd {
  readonly variant: LayoutVariant;
  readonly runId: string;
  readonly state: 'done' | 'failed';
}

interface BuildRetry {
  variant?: LayoutVariant;
  buildId: string;
  plan?: CompositionPlan;
  build?: BuildRecord;
  /** A competing retry already owns execution: observe it rather than queue another retry. */
  observeExisting?: boolean;
  /** Keep time spent waiting for a lease inside the same bounded recovery request. */
  startedAt?: number;
}

/**
 * The revision of the engine's generation profile. Raise it when the engine reads something new
 * from a template, so templates prepared before are read again: 2 added places for pictures,
 * 3 the sample photos of a slide among them, 4 all picture candidates for explicit QR slots.
 */
export const PROFILE_REVISION = 5;

export interface StoredTemplate {
  readonly storage_path: string;
  readonly file_name: string;
  readonly profile: {
    generation?: GenerationProfile;
    /** The revision of the engine's reading the generation profile came from. */
    generationRevision?: number;
    index?: unknown;
    previews?: unknown;
    designSystem?: unknown;
  };
}

/**
 * Preparing templates and building decks. The generation endpoints and the chat agent both start
 * builds here, so a build from the chat is the same three runs the library shows.
 */
/**
 * The image model a build draws with: the one assigned to the image role in the settings, else
 * the server's `IMAGE_BASE_URL` and `IMAGE_MODEL` when both are set, else none. `IMAGE_PROVIDER`
 * set to `fake` draws one-colour pictures without a network, for an offline demo.
 */
export function imageProviderOf(
  assigned: { apiKey: string; baseUrl: string; model: string } | null,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): ImageProvider | null {
  if (env.IMAGE_PROVIDER === 'fake') return new FakeImageProvider();
  if (assigned)
    return new OpenAICompatibleImageProvider({ ...assigned, ...(fetchImpl ? { fetchImpl } : {}) });
  if (env.IMAGE_BASE_URL && env.IMAGE_MODEL)
    return new OpenAICompatibleImageProvider({
      baseUrl: env.IMAGE_BASE_URL,
      apiKey: env.MODEL_API_KEY ?? '',
      model: env.IMAGE_MODEL,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  return null;
}

@Injectable()
export class GenerationService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly root = resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs'));
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  readonly engine = new EngineClient({
    baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 120000,
  });
  /** Drawing a large template takes the office suite about a minute. */
  private readonly drawingEngine = new EngineClient({
    baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 900000,
  });
  private readonly active = new Map<string, AbortController>();
  private readonly executions = new Map<string, StartedBuild>();
  private readonly leases = new Map<string, BuildLease>();
  private readonly shutdown = new AbortController();
  private get builds() {
    return new GenerationBuildStore(this.pool);
  }
  readonly library = new LibraryMetadata(this.root);
  private readonly logger = new Logger(GenerationService.name);
  /** Templates being prepared right now, and how far each has got. */
  private readonly preparing = new Map<string, PrepareProgress>();
  /** Templates whose slides are being drawn right now: a second request does not start again. */
  private readonly drawing = new Set<string>();
  /**
   * Clock and wall-clock cap for a build. Production uses `Date.now` and the existing 290s
   * ceiling. Tests replace them so a deadline can pass without waiting out the real cap.
   */
  now: () => number = () => Date.now();
  deadlineMs = BUILD_DEADLINE_MS;

  constructor(
    @Inject(RUN_REPOSITORY) readonly repository: RunRepository,
    @Inject(ModelSettingsService) private readonly models: ModelSettingsService,
    @Inject(ModelCapabilityService) private readonly capabilities: ModelCapabilityService,
    @Optional() @Inject(AccountUsageService) private readonly accountUsage?: AccountUsageService,
  ) {}

  directory(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new BadRequestException('Invalid run id.');
    return join(this.root, id);
  }

  preparationOf(templateId: string): { progress: PrepareProgress | null; drawing: boolean } {
    return {
      progress: this.preparing.get(templateId) ?? null,
      drawing: this.drawing.has(templateId),
    };
  }

  /**
   * The template has a generation profile of the current reading: a deck can be built in it now.
   * A profile read before the engine learned something new (places for pictures) is read again.
   */
  static prepared(template: StoredTemplate): boolean {
    return (
      template.profile?.generationRevision === PROFILE_REVISION &&
      generationProfileSchema.safeParse(template.profile.generation).success
    );
  }

  /**
   * Read the template's generation profile and have its compositions described. The pictures of
   * its sample slides are for the library, not the deck: they are drawn but never waited for.
   */
  async prepare(templateId: string, model: ModelRef | null, account: Account): Promise<void> {
    const row = await this.template(templateId, account);
    void this.drawPreviews(templateId, row);
    const progress: PrepareProgress = { stage: 'profile', described: 0, total: 0 };
    this.preparing.set(templateId, progress);
    try {
      const profile = await this.engine.generationProfile(row.storage_path);
      await this.pool.query(
        "UPDATE stored_files SET profile = profile || jsonb_build_object('generation', $2::jsonb, 'generationRevision', $3::int) WHERE id = $1",
        [templateId, JSON.stringify(profile), PROFILE_REVISION],
      );
      progress.stage = 'index';
      await this.indexTemplate(templateId, profile, row.profile?.index, model, account, (step) => {
        progress.described = step.described;
        progress.total = step.total;
      });
    } finally {
      // A later request for the same template reports on its own.
      if (this.preparing.get(templateId) === progress) this.preparing.delete(templateId);
    }
  }

  /**
   * Draw every slide of the template once, for the library to show the sample slides a deck is
   * built from as they are. The file names go into the profile; a failure is logged and the
   * library falls back to the slides it draws itself.
   */
  private async drawPreviews(templateId: string, row: StoredTemplate): Promise<void> {
    if (Array.isArray(row.profile?.previews) || this.drawing.has(templateId)) return;
    this.drawing.add(templateId);
    try {
      const drawn = await this.drawingEngine.templatePreviews({
        schemaVersion: 1,
        templatePath: row.storage_path,
        outputDir: join(dirname(row.storage_path), 'previews'),
        widthPx: TEMPLATE_PREVIEW_WIDTH,
      });
      await this.pool.query(
        "UPDATE stored_files SET profile = profile || jsonb_build_object('previews', $2::jsonb) WHERE id = $1",
        [templateId, JSON.stringify(drawn.previews)],
      );
    } catch (error) {
      this.logger.warn(
        `Slides of template ${templateId} were not drawn: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.drawing.delete(templateId);
    }
  }

  /**
   * Describe the template's compositions once per template and indexer revision. Preparation is
   * outside the timed generation stage; a failure only leaves the planner without the notes, so
   * it is logged and never blocks the deck.
   */
  private async indexTemplate(
    templateId: string,
    profile: GenerationProfile,
    stored: unknown,
    model: ModelRef | null,
    account: Account,
    onProgress: (progress: IndexProgress) => void,
  ): Promise<void> {
    try {
      const registryDir = this.registryDir();
      const revision = await currentTemplateIndexRevision(registryDir);
      const previous = storedTemplateIndexSchema.safeParse(stored);
      if (previous.success && templateIndexState(profile, previous.data, revision) === 'ready')
        return;
      const resolved =
        (await this.models.resolveRole('planner', actorOf(account))) ??
        (await this.models.resolve(model, actorOf(account)));
      const rawProvider = new GenerationProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
        headers: resolved.headers,
        answerFormat: await loadAnswerFormat(registryDir),
        fetchImpl: ledgerFetch(
          new PostgresProviderLedger(this.pool, account.id, null, {
            requests: 10000,
            tokens: 100_000_000,
            cost: null,
          }),
          'template-index',
          fetch,
          undefined,
          resolved,
        ),
      });
      const provider = new CheckpointTextProvider(
        rawProvider,
        new TaskCheckpoints(
          join(this.root, `template-index-${templateId}`),
          dependencyKey({
            profile,
            revision,
            model: resolved.model,
            connection: resolved.connectionId,
            endpoint: resolved.baseUrl,
          }),
        ),
      );
      const index: StoredTemplateIndex = await indexTemplateWithAgent({
        provider,
        registryDir,
        profile,
        onProgress,
        // Outside the generation budget, and a large template on a slow model takes minutes:
        // the indexer asks again about what an answer left out.
        signal: AbortSignal.timeout(600000),
      });
      await this.pool.query(
        "UPDATE stored_files SET profile = profile || jsonb_build_object('index', $2::jsonb) WHERE id = $1",
        [templateId, JSON.stringify(index)],
      );
    } catch (error) {
      this.logger.warn(
        `Template ${templateId} was not indexed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  registryDir(): string {
    const found =
      process.env.REGISTRY_DIR ||
      [resolve('registry/agents'), resolve('../../registry/agents')].find(existsSync);
    if (!found) throw new BadRequestException('REGISTRY_DIR is not configured.');
    return found;
  }

  /** A template the account may use; another account's private one is answered as missing. */
  async template(id: string, account: Account): Promise<StoredTemplate> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid template id.');
    const result = await this.pool.query<StoredTemplate>(
      `SELECT storage_path, file_name, profile FROM stored_files
       WHERE id = $1 AND kind = 'template' AND ${visibleFile(2)}`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Template not found.');
    return row;
  }

  /** Validate the selected brandbook before a chat build starts. */
  async brandbook(id: string, account: Account): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{ profile: Record<string, unknown> }>(
      `SELECT profile FROM stored_files WHERE id=$1 AND kind='brandbook' AND ${visibleFile(2)}`,
      [id, account.id],
    );
    const row = result.rows[0];
    if (!row?.profile) throw new NotFoundException('Brandbook not found.');
    return row.profile;
  }

  async requireProject(id: string, account: Account): Promise<void> {
    const found = await this.pool.query(
      'SELECT id FROM library_projects WHERE id = $1 AND owner_id = $2',
      [id, account.id],
    );
    if (!found.rowCount) throw new NotFoundException('Project not found.');
  }
  async projectTemplates(
    projectId: string | null,
    account: Account,
  ): Promise<{ templateId: string; name: string }[]> {
    if (projectId === null) return [];
    await this.requireProject(projectId, account);
    const result = await this.pool.query<{ templateId: string; name: string }>(
      `SELECT f.id AS "templateId",COALESCE(f.display_name,f.file_name) AS name FROM library_project_templates t
       JOIN stored_files f ON f.id=t.template_id WHERE t.project_id=$1 AND f.kind='template' AND ${visibleFile(2, 'f')}
       ORDER BY f.id`,
      [projectId, account.id],
    );
    return result.rows;
  }

  /** Interrupt local execution after an infrastructure failure, without persisting user Stop. */
  interrupt(runId: string): void {
    this.active.get(runId)?.abort(new Error('Build interrupted by a persistence failure.'));
  }

  /** Stop a build: its variants share one cancellation, so any of their runs stops all three. */
  async cancel(runId: string): Promise<void> {
    this.active.get(runId)?.abort(new DOMException('Сборка остановлена.', 'AbortError'));
    const raw = await readFile(join(this.directory(runId), 'metadata.json'), 'utf8');
    const metadata = JSON.parse(raw) as { buildId?: string; ownerId?: string };
    if (metadata.buildId && metadata.ownerId)
      await this.builds.stop(metadata.buildId, metadata.ownerId);
  }

  /** Whether a build of this person gets pictures: an image model is assigned or configured. */
  async imagesAvailable(account: Account): Promise<boolean> {
    return imageProviderOf(await this.models.resolveRole('image', actorOf(account))) !== null;
  }

  async usage(runId: string, account: Account) {
    if (!(await this.library.visible(runId, account.id)))
      throw new NotFoundException('Run not found.');
    const metadata = await this.library.read(runId);
    if (!metadata.buildId) throw new NotFoundException('Usage journal unavailable for legacy run.');
    const result = await this.pool.query(
      `SELECT count(*)::int AS attempts,count(DISTINCT task_key)::int AS tasks,
       COALESCE(sum(input_tokens),0) AS input,COALESCE(sum(output_tokens),0) AS output,
       count(*) FILTER(WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown_usage,
       sum(actual_cost) AS cost,count(*) FILTER(WHERE actual_cost IS NULL)::int AS unknown_cost,
       CASE WHEN count(DISTINCT currency)=1 THEN min(currency) ELSE NULL END AS currency
       FROM provider_attempts WHERE build_id=$1 AND owner_id=$2`,
      [metadata.buildId, account.id],
    );
    const row = result.rows[0];
    return generationUsageSchema.parse({
      httpAttempts: row.attempts,
      logicalTasks: row.tasks,
      knownInputTokens: Number(row.input),
      knownOutputTokens: Number(row.output),
      unknownUsageAttempts: row.unknown_usage,
      knownCost: row.cost === null || row.currency === null ? null : Number(row.cost),
      unknownCostAttempts: row.unknown_cost,
      currency: row.currency,
    });
  }

  /**
   * Build again one failed variant with its stable run id. It writes
   * from the request and the plan the build kept, so it tells the same story as the variants
   * that made it, without calling the planner again.
   */
  async retryVariant(runId: string, account: Account): Promise<StartedBuild> {
    if (!/^run-[0-9a-f-]{36}$/i.test(runId)) throw new NotFoundException('Run not found.');
    const directory = this.directory(runId);
    const read = async (name: string): Promise<unknown> =>
      JSON.parse(await readFile(join(directory, name), 'utf8'));
    const metadata = await read('metadata.json').catch(() => null);
    const owned =
      typeof metadata === 'object' && metadata !== null && 'ownerId' in metadata
        ? (metadata as { ownerId?: unknown; variant?: unknown; buildId?: unknown })
        : null;
    if (!owned || owned.ownerId !== account.id) throw new NotFoundException('Run not found.');
    const variant = layoutVariantSchema.safeParse(owned.variant);
    if (!variant.success || typeof owned.buildId !== 'string')
      throw new ConflictException('This run is not a variant of a build.');
    if ((await this.repository.get(runId))?.state === 'done')
      throw new ConflictException('Only a failed variant can be built again.');
    const request = generationRequestSchema.safeParse(await read('request.json').catch(() => null));
    if (!request.success)
      throw new ConflictException('This build predates rebuilding a variant; build it again.');
    // A build that failed before its plan was made has none: the variant plans anew.
    const plan = compositionPlanSchema.safeParse(
      await read('composition-plan.json').catch(() => null),
    );
    const build = await this.builds.get(owned.buildId, account.id);
    if (!build)
      throw new ConflictException(
        'Для старой сборки недостаточно данных восстановления. Создайте новую генерацию.',
      );
    return this.start(request.data, account, {
      variant: variant.data,
      buildId: owned.buildId,
      ...(plan.success ? { plan: plan.data } : {}),
      build,
    });
  }

  /** Explicit resume keeps the build and run ids and leaves successful variants untouched. */
  async resume(runId: string, account: Account): Promise<StartedBuild> {
    const metadata = JSON.parse(
      await readFile(join(this.directory(runId), 'metadata.json'), 'utf8').catch(() => '{}'),
    ) as { ownerId?: string; buildId?: string };
    if (metadata.ownerId !== account.id || !metadata.buildId)
      throw new NotFoundException('Run not found.');
    const build = await this.builds.get(metadata.buildId, account.id);
    if (!build)
      throw new ConflictException(
        'Сборка не содержит совместимых checkpoints. Создайте новую генерацию.',
      );
    const spec = generationSpecSchema.parse(build.spec);
    const plan = compositionPlanSchema.safeParse(
      JSON.parse(
        await readFile(join(this.directory(runId), 'composition-plan.json'), 'utf8').catch(
          () => 'null',
        ),
      ),
    );
    return this.start(spec.request, account, {
      buildId: build.id,
      build,
      ...(plan.success ? { plan: plan.data } : {}),
    });
  }

  /** The run is still being built in this process. */
  isRunning(runId: string): boolean {
    return this.active.has(runId);
  }

  /** Continue waits safely for ownership before recovering expired work.
   * A live sibling execution must finish before a queued variant retry may claim the build.
   */
  private followBuild(
    input: GenerationRequest,
    account: Account,
    build: BuildRecord,
    retry?: BuildRetry,
    onActivity?: (activity: ChatToolActivity) => void,
    previous?: StartedBuild,
  ): StartedBuild {
    const variants = build.variants.filter(
      (entry) => !retry?.variant || entry.variant === retry.variant,
    );
    const primary = variants.find((entry) => entry.variant === 'balanced') ?? variants[0];
    if (!primary) throw new ConflictException('Варианты сборки не найдены.');
    const budget = openBuildBudget(
      retry?.startedAt ?? this.now(),
      this.shutdown.signal,
      this.deadlineMs,
      this.now(),
    );
    const gate = <T>(work: () => Promise<T>) => waitForBuild(work, budget);
    const settled = (async (): Promise<readonly VariantEnd[]> => {
      if (previous) await gate(() => previous.settled);
      for (;;) {
        const current = await gate(() => this.builds.get(build.id, account.id));
        if (!current) throw new NotFoundException('Сборка не найдена.');
        const ends = await gate(() =>
          Promise.all(
            variants.map(async (entry): Promise<VariantEnd> => ({
              ...entry,
              state: (await this.repository.get(entry.runId))?.state === 'done' ? 'done' : 'failed',
            })),
          ),
        );
        if (current.status === 'stopped' || ends.every((end) => end.state === 'done')) return ends;
        if (!(await gate(() => this.builds.hasLiveLease(build.id)))) {
          if (
            retry &&
            (!retry.observeExisting ||
              current.status === 'running' ||
              current.status === 'interrupted')
          ) {
            const recovered = await gate(() =>
              this.start(
                input,
                account,
                {
                  ...retry,
                  build: current,
                  observeExisting: true,
                  startedAt: budget.startedAt,
                },
                onActivity,
              ),
            );
            return await gate(() => recovered.settled);
          }
          return ends;
        }
        await gate(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
      }
    })()
      .catch((error: unknown) => {
        this.logger.warn(`Build ${build.id} recovery wait failed: ${String(error)}`);
        return variants.map((entry): VariantEnd => ({ ...entry, state: 'failed' }));
      })
      .finally(() => budget.dispose());
    const each = variants.map(
      async (entry): Promise<VariantEnd> =>
        (await settled).find((end) => end.runId === entry.runId) ?? { ...entry, state: 'failed' },
    );
    return { runId: primary.runId, variants, each, settled: Promise.all(each) };
  }

  /**
   * Start the three variants of a brief. They run in the background; `settled` tells how each
   * ended. With an outline the planner lays out its slides, and their number is the outline's.
   * A failed variant can be started again on the plan this build kept.
   */
  async start(
    input: GenerationRequest,
    account: Account,
    retry?: BuildRetry,
    onActivity?: (activity: ChatToolActivity) => void,
  ): Promise<StartedBuild> {
    const startedAt = retry?.startedAt ?? this.now();
    const schedulingGroup = input.requestId ?? randomUUID();
    const controller = new AbortController();
    const budget = openBuildBudget(
      startedAt,
      AbortSignal.any([controller.signal, this.shutdown.signal]),
      this.deadlineMs,
      this.now(),
    );
    let handedOff = false;
    let lease: BuildLease | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const signal = budget.signal;
      const gate = <T>(pending: () => Promise<T>): Promise<T> => waitForBuild(pending, budget);
      const projectId = input.projectId;
      if (projectId !== null) await gate(() => this.requireProject(projectId, account));
      const requestKey = schedulingGroup;
      // A retry/resume must use the immutable snapshot kept with the build. In particular,
      // the brandbook may have been deleted or become invisible after the original ACL check.
      const previous =
        retry?.build ??
        (input.requestId ? await gate(() => this.builds.byRequest(account.id, requestKey)) : null);
      const previousSpec = previous ? generationSpecSchema.safeParse(previous.spec) : null;
      if (previous && (!previousSpec || !previousSpec.success))
        throw new ConflictException('Сборка содержит несовместимую спецификацию.');
      const template = await gate(() => this.template(input.templateId, account));
      const prepared = generationProfileSchema.safeParse(template.profile?.generation);
      if (!prepared.success)
        throw new BadRequestException('Prepare the template before generation.');
      let brandbook: BrandbookBinding | undefined = previousSpec?.success
        ? previousSpec.data.brandbook
        : undefined;
      if (!previous && input.brandbookId) {
        const selected = await gate(() =>
          this.pool.query<{ profile: unknown }>(
            `SELECT profile FROM stored_files WHERE id=$1 AND kind='brandbook' AND ${visibleFile(2)}`,
            [input.brandbookId, account.id],
          ),
        );
        const profile = selected.rows[0]?.profile;
        if (!profile) throw new NotFoundException('Brandbook not found.');
        brandbook = brandbookBindingSchema.parse({
          schemaVersion: 1,
          profile,
          priority: input.brandbookPriority ?? 'brandbook',
        });
      }
      let brief = previousSpec?.success ? previousSpec.data.brief : input.brief;
      for (const id of previous ? [] : input.contentIds) {
        const files = await gate(() =>
          this.pool.query<{ storage_path: string; file_name: string }>(
            `SELECT storage_path, file_name FROM stored_files
         WHERE id = $1 AND kind = 'content' AND ${visibleFile(2)}`,
            [id, account.id],
          ),
        );
        const stored = files.rows[0];
        if (!stored) throw new BadRequestException('There is no such content file.');
        const material = await gate(() =>
          readPreparedMaterial(
            this.engine,
            {
              sourceId: id,
              name: stored.file_name,
              path: stored.storage_path,
            },
            signal,
          ),
        );
        brief += `\n\nSource ${id}:\n${material.text}`;
      }
      if (brief.length > 60000) throw new BadRequestException('Content exceeds 60000 characters.');
      // The models are settled before a run exists: without one there is nothing to start, and the
      // person gets the reason in the answer rather than a run that fails without one.
      const settle = <T>(pending: Promise<T>): Promise<T> =>
        pending.catch((error: unknown) => {
          if (error instanceof ModelNotConfiguredError)
            throw new ServiceUnavailableException({
              code: 'model-not-configured',
              message: error.message,
            });
          throw error;
        });
      const actor = actorOf(account);
      const writer = await gate(() => settle(this.models.resolve(input.model, actor)));
      // Planner and critic run on the models of their roles; a role without one writes with the
      // writer's model, and the slot rewriter always does.
      const [planner, critic] = await gate(() =>
        settle(
          Promise.all([
            this.models.resolveRole('planner', actor),
            this.models.resolveRole('critic', actor),
          ]),
        ),
      );
      // The schema of each answer goes into the instructions too: a model that ignores structured
      const [vision, imageModel] = await gate(() =>
        settle(
          Promise.all([
            this.models.resolveRole('vision', actor),
            this.models.resolveRole('image', actor),
          ]),
        ),
      );
      // The schema of each answer goes into the instructions too: a model that ignores structured
      // output still answers in shape.
      const answerFormat = await gate(() => loadAnswerFormat(this.registryDir()));
      // How each model thinks is what probing it showed, settled before the run starts.
      const [writerReasoning, plannerReasoning, criticReasoning] = await gate(() =>
        Promise.all(
          [writer, planner, critic].map((model) =>
            model ? this.capabilities.reasoningOf(model) : Promise.resolve(undefined),
          ),
        ),
      );
      const attemptBudget = new AttemptBudget();
      let transport: (
        model: ResolvedModel,
        ...args: Parameters<typeof fetch>
      ) => ReturnType<typeof fetch> = async () => {
        throw new Error('Журнал запросов ещё не открыт.');
      };
      const providerOf = (model: ResolvedModel, reasoning: ReasoningCapability | undefined) =>
        new GenerationProvider({
          apiKey: model.apiKey,
          baseUrl: model.baseUrl,
          model: model.model,
          headers: model.headers,
          seed: input.seed,
          thinking: input.thinking,
          reasoningEffort: input.reasoningEffort,
          ...(reasoning ? { reasoning } : {}),
          answerFormat,
          attemptBudget,
          queueGroup: schedulingGroup,
          fetchImpl: (...args) => transport(model, ...args),
          onActivity: (event) => onActivity?.({ ...event, kind: 'agent' }),
        });
      const fallback = providerOf(writer, writerReasoning);
      const provider = new RoutedTextProvider(
        fallback,
        new Map([
          ['writer', fallback],
          ['rewriter', fallback],
          ...(planner ? [['planner', providerOf(planner, plannerReasoning)] as const] : []),
          ...(critic ? [['critic', providerOf(critic, criticReasoning)] as const] : []),
        ]),
      );
      const registryDir = this.registryDir();
      const index = storedTemplateIndexSchema.safeParse(template.profile?.index);
      // Notes describe the profile they were made from; a re-parsed template drops stale ones.
      const notes = previousSpec?.success
        ? previousSpec.data.notes
        : index.success &&
            templateIndexState(
              prepared.data,
              index.data,
              await currentTemplateIndexRevision(registryDir),
            ) === 'ready'
          ? index.data.notes
          : undefined;
      let prices: ReturnType<typeof tokenPriceResolver> | undefined;
      try {
        const pricingBytes = process.env.MODEL_PRICING_FILE
          ? await readFile(process.env.MODEL_PRICING_FILE, 'utf8')
          : null;
        prices = pricingBytes ? tokenPriceResolver(JSON.parse(pricingBytes)) : undefined;
      } catch {
        this.logger.warn('Tariff catalog is invalid; usage cost remains unknown.');
      }
      // Observing an existing build consumes no execution slot. Reject genuinely new work
      // before creating its durable records when both local build slots are occupied.
      if (!previous && this.active.size >= 2 * VARIANTS.length)
        throw new BadRequestException('Two generations are already running.');
      const registryFiles = (await readdir(registryDir, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();
      const registryHash = dependencyKey(
        await Promise.all(
          registryFiles.map(async (path) => [
            path.slice(registryDir.length),
            await readFile(path, 'utf8'),
          ]),
        ),
      );
      const spec = generationSpecSchema.parse({
        schemaVersion: 1,
        request: previousSpec?.success ? previousSpec.data.request : input,
        brief,
        profile: previousSpec?.success ? previousSpec.data.profile : prepared.data,
        ...(brandbook ? { brandbook } : {}),
        ...(notes ? { notes } : {}),
        registryHash,
        // Pricing describes each physical attempt; it cannot invalidate accepted content on resume.
        ...(previousSpec?.success && previousSpec.data.pricingHash
          ? { pricingHash: previousSpec.data.pricingHash }
          : {}),
        today: previous
          ? previousSpec?.success
            ? previousSpec.data.today
            : new Date().toISOString()
          : `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
        modelPolicy: [
          ['writer', writer, writerReasoning],
          ['planner', planner, plannerReasoning],
          ['critic', critic, criticReasoning],
          ['vision', vision, null],
          ['image', imageModel, null],
        ]
          .filter(([, model]) => model !== null)
          .map(([role, model, reasoning]) => ({
            role,
            modelId: (model as ResolvedModel).model,
            connectionId: (model as ResolvedModel).connectionId,
            endpointHash: dependencyKey((model as ResolvedModel).baseUrl),
            reasoning,
          })),
      });
      const specHash = dependencyKey(spec);
      if (previous && previous.spec_hash !== specHash)
        throw new ConflictException(
          'Входы, шаблон или модельная политика изменились. Создайте новую генерацию.',
        );
      const buildRecord =
        previous ?? (await this.builds.create(account.id, requestKey, specHash, spec));
      const already = this.executions.get(buildRecord.id);
      if (already) {
        if (!retry) return already;
        const requested = buildRecord.variants.filter(
          (entry) => !retry.variant || entry.variant === retry.variant,
        );
        if (
          !retry.observeExisting ||
          requested.some(
            (entry) => !already.variants.some((active) => active.runId === entry.runId),
          )
        )
          return this.followBuild(
            input,
            account,
            buildRecord,
            { ...retry, observeExisting: false },
            onActivity,
            already,
          );
        const variants = already.variants.filter(
          (entry) => !retry.variant || entry.variant === retry.variant,
        );
        const each = already.each.filter((_, index) =>
          variants.some((entry) => entry.runId === already.variants[index]?.runId),
        );
        const primary = variants.find((entry) => entry.variant === 'balanced') ?? variants[0];
        if (!primary) throw new ConflictException('Варианты сборки не найдены.');
        return { runId: primary.runId, variants, each, settled: Promise.all(each) };
      }
      if (
        this.active.size >= 2 * VARIANTS.length &&
        !(await this.builds.hasLiveLease(buildRecord.id))
      )
        throw new BadRequestException('Two generations are already running.');
      lease = await this.builds.claim(
        buildRecord.id,
        account.id,
        retry !== undefined && buildRecord.status === 'stopped',
      );
      if (!lease) {
        return this.followBuild(input, account, buildRecord, retry, onActivity);
      }
      const executionLease = lease;
      this.leases.set(buildRecord.id, executionLease);
      const admit = () =>
        new AccountUsageStore(this.pool).admit(account.id, buildRecord.id, 'generation');
      if (this.accountUsage) await this.accountUsage.translate(admit);
      else await admit();
      const ledger = new PostgresProviderLedger(this.pool, account.id, executionLease, {
        requests: input.budget?.maxHttpRequests ?? 240,
        tokens: input.budget?.maxReservedTokens ?? 2_000_000,
        cost: null,
      });
      transport = (model, ...args) =>
        ledgerFetch(ledger, 'generation', fetch, prices, model)(...args);
      const assertOwner = async () => {
        signal.throwIfAborted();
        await this.builds.assert(executionLease);
      };
      heartbeat = setInterval(() => {
        void this.builds.renew(executionLease).catch((error: unknown) => controller.abort(error));
      }, 10_000);
      const checkpoints = new TaskCheckpoints(
        join(this.root, `build-${buildRecord.id}`, 'tasks'),
        specHash,
        assertOwner,
      );
      const checkpointProvider = new SemanticTextProvider(
        new CheckpointTextProvider(provider, checkpoints),
      );
      const sharedContent = new SharedContent();
      // The three variants of one brief are separate runs, so every deck endpoint serves each of
      // them as it is, and they share one cancellation.
      // One plan for the three variants: the story is decided once, the layouts per variant. Each
      // run keeps it, so a variant that fails can be built again on the same story.
      const sharedPlan = new SharedPlan(retry?.plan, async (plan) => {
        await assertOwner();
        for (const { run } of runs) {
          await atomicJson(join(this.directory(run.runId), 'composition-plan.json'), plan);
        }
      });
      // The model of the "vision" role reads the drawn slides for the contextual audit. Without one
      // the build has the deterministic audit and the critic's read of the text, and says so.
      const reviewer = vision
        ? {
            model: vision.model,
            provider: new VisionProvider({
              apiKey: vision.apiKey,
              baseUrl: vision.baseUrl,
              model: vision.model,
              headers: vision.headers,
              seed: input.seed,
              answerFormat,
              signal,
              attemptBudget,
              fetchImpl: ledgerFetch(ledger, 'vision', fetch, prices, vision),
              queueGroup: schedulingGroup,
            }),
          }
        : null;
      // Pictures too are drawn once per brief. Without an image model the planner is not offered
      // a place for a picture, so no slide is left with an empty frame.
      const images = imageProviderOf(
        imageModel,
        process.env,
        ledgerFetch(ledger, 'images', fetch, prices, imageModel ?? undefined),
      );
      const illustrations = images
        ? await gate(() =>
            SharedIllustrations.load(
              {
                images,
                text: checkpointProvider,
                checkpoints,
                designSystem: prepared.data.designSystem,
                seed: input.seed ?? 42,
                signal,
              },
              registryDir,
            ),
          )
        : null;
      const modelPlan = effectiveModelPlan({
        startedAt: budget.startedAt,
        deadlineAt: budget.deadlineAt,
        attemptBudgetMax: attemptBudget.max,
        thinking: input.thinking,
        reasoningEffort: input.reasoningEffort,
        writerExplicit: input.model !== null,
        writer: { modelId: writer.model, connectionId: writer.connectionId },
        planner: planner ? { modelId: planner.model, connectionId: planner.connectionId } : null,
        critic: critic ? { modelId: critic.model, connectionId: critic.connectionId } : null,
        vision: vision ? { modelId: vision.model, connectionId: vision.connectionId } : null,
      });
      const runs: {
        run: Awaited<ReturnType<RunRepository['create']>>;
        variant: LayoutVariant;
      }[] = [];
      // The variants are one build: the library shows it once. A variant built again joins it.
      const buildId = buildRecord.id;
      try {
        for (const entry of buildRecord.variants.filter(
          (entry) => !retry?.variant || entry.variant === retry.variant,
        )) {
          const variant = entry.variant;
          if (signal.aborted) throw buildStopReason(signal);
          const run = await this.repository.get(entry.runId);
          if (!run) throw new ConflictException('Прогон сборки не найден.');
          runs.push({ run, variant });
          this.active.set(run.runId, controller);
          if (signal.aborted) throw buildStopReason(signal);
          const runFiles = {
            'metadata.json': JSON.stringify({
              templateId: input.templateId,
              projectId: input.projectId,
              ownerId: account.id,
              variant,
              buildId,
              updatedAt: Date.now(),
            }),
            'request.json': JSON.stringify(input),
            'model-plan.json': JSON.stringify(modelPlan),
            ...(retry?.plan ? { 'composition-plan.json': JSON.stringify(retry.plan) } : {}),
          };
          if (this.accountUsage)
            await this.accountUsage.writeFiles(account.id, this.directory(run.runId), runFiles);
          else {
            await mkdir(this.directory(run.runId), { recursive: true });
            for (const [name, contents] of Object.entries(runFiles)) {
              if (signal.aborted) throw buildStopReason(signal);
              await writeFile(join(this.directory(run.runId), name), contents);
            }
          }
          if (signal.aborted) throw buildStopReason(signal);
        }
      } catch (error) {
        for (const { run } of runs) {
          this.active.delete(run.runId);
          await this.repository.transition(run.runId, 'failed').catch(() => undefined);
        }
        throw error;
      }
      const work = async ({ run, variant }: (typeof runs)[number]) => {
        const attemptDir = join(
          this.directory(run.runId),
          'executions',
          String(executionLease.fence),
        );
        let done: Extract<JobEvent, { type: 'done' }> | undefined;
        try {
          if (run.state === 'done') return 'done' as const;
          await assertOwner();
          if (signal.aborted) throw buildStopReason(signal);
          await this.repository.transition(run.runId, 'running');
          await generatePresentation({
            planId: buildRecord.id,
            providerUsage: () => this.usage(run.runId, account),
            runId: run.runId,
            templatePath: template.storage_path,
            outputDir: attemptDir,
            brief,
            slideCount: input.outline ? null : input.slideCount,
            outline: input.outline,
            outlineSource: input.outlineSource,
            profile: previousSpec?.success ? previousSpec.data.profile : prepared.data,
            ...(brandbook ? { brandbook } : {}),
            ...(notes ? { notes } : {}),
            registryDir,
            engine: this.engine,
            provider: checkpointProvider,
            seed: input.seed,
            variant,
            sharedPlan,
            sharedContent,
            layoutRemapPolicy: 'conceptual',
            today: new Date(spec.today),
            illustrations,
            reviewer,
            signal,
            deadlineAt: budget.deadlineAt,
            eventSequence: ((await this.repository.events(run.runId)).at(-1)?.seq ?? -1) + 1,
            onEvent: async (event) => {
              if (event.type === 'done') done = event;
              else await this.builds.publish(executionLease, event);
            },
          });
          if (input.projectId !== null) {
            const project = await this.pool.query(
              'UPDATE library_projects SET updated_at = now() WHERE id = $1 RETURNING id',
              [input.projectId],
            );
            if (!project.rowCount) await this.library.remove(run.runId);
          }
          await assertOwner();
          if (!done) throw new Error('Сборка не подтвердила завершение.');
          await atomicJson(join(attemptDir, 'provider-usage.json'), await ledger.summary());
          const publication = () =>
            this.builds.publish(executionLease, done as JobEvent, async () => {
              const names = (await readdir(attemptDir)).filter((name) => name !== 'manifest.json');
              // The manifest is the final publication marker. A stale worker writes only its
              // own execution directory and can never replace these files after lease loss.
              for (const name of [...names, 'manifest.json']) {
                signal.throwIfAborted();
                const target = join(this.directory(run.runId), name);
                const temporary = `${target}.${executionLease.fence}.publish`;
                await cp(join(attemptDir, name), temporary, { recursive: true, force: true });
                // Directory publication (previews/media) uses a fence-specific name in the
                // original deck paths; existing root directories can be merged safely here.
                try {
                  await rename(temporary, target);
                } catch (error) {
                  if (
                    !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(
                      (error as NodeJS.ErrnoException).code ?? '',
                    )
                  )
                    throw error;
                  await cp(temporary, target, { recursive: true, force: true });
                  await rm(temporary, { recursive: true, force: true });
                }
              }
              signal.throwIfAborted();
            });
          if (this.accountUsage)
            await this.accountUsage.write(
              account.id,
              await directoryBytes(attemptDir),
              publication,
            );
          else await publication();
          return 'done' as const;
        } catch (error) {
          this.logger.warn(`Variant ${run.runId} failed: ${String(error)}`);
          if (!this.shutdown.signal.aborted)
            await this.builds
              .assert(executionLease)
              .then(() => this.repository.transition(run.runId, 'failed'))
              .catch(() => undefined);
          return 'failed' as const;
        } finally {
          this.active.delete(run.runId);
        }
      };
      const each = runs.map(async (entry): Promise<VariantEnd> => ({
        variant: entry.variant,
        runId: entry.run.runId,
        state: await work(entry),
      }));
      const settled = Promise.all(each)
        .then(async (ends) => {
          if (!this.shutdown.signal.aborted) {
            const all = await Promise.all(
              buildRecord.variants.map((entry) => this.repository.get(entry.runId)),
            );
            await this.builds
              .finish(executionLease, all.every((run) => run?.state === 'done') ? 'done' : 'failed')
              .catch((error: unknown) => this.logger.warn(String(error)));
          }
          return ends;
        })
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          this.executions.delete(buildRecord.id);
          this.leases.delete(buildRecord.id);
          controller.abort();
          budget.dispose();
        });
      const primary = runs.find((entry) => entry.variant === 'balanced') ?? runs[0];
      if (!primary) throw new BadRequestException('No variant could be started.');
      const result = {
        runId: primary.run.runId,
        variants: runs.map(({ run, variant }) => ({ variant, runId: run.runId })),
        each,
        settled,
      };
      handedOff = true;
      this.executions.set(buildRecord.id, result);
      return result;
    } catch (error) {
      if (error instanceof BuildConflictError) throw new ConflictException(error.message);
      throw error;
    } finally {
      if (!handedOff) {
        if (heartbeat) clearInterval(heartbeat);
        if (lease) await this.builds.finish(lease, 'interrupted').catch(() => undefined);
        if (lease) this.leases.delete(lease.build.id);
        controller.abort();
        budget.dispose();
      }
    }
  }

  /**
   * Close interrupted runs without an owner, retaining their durable checkpoints.
   * A live lease may belong to another process and must be respected. An explicit Continue
   * follows that lease and recovers the build if ownership subsequently expires.
   */
  async onApplicationBootstrap(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const id of await readdir(this.root)) {
      if (!/^run-[0-9a-f-]{36}$/i.test(id) || this.active.has(id)) continue;
      try {
        const run = await this.repository.get(id);
        if (run?.state !== 'queued' && run?.state !== 'running') continue;
        const metadata = JSON.parse(
          await readFile(join(this.directory(id), 'metadata.json'), 'utf8').catch(() => '{}'),
        ) as { buildId?: string };
        if (metadata.buildId && (await this.builds.hasLiveLease(metadata.buildId))) continue;
        const last = (await this.repository.events(id)).at(-1);
        await this.repository.appendEvent(id, {
          schemaVersion: 1,
          runId: id,
          seq: (last?.seq ?? -1) + 1,
          at: new Date().toISOString(),
          type: 'failed',
          stage: last && 'stage' in last ? last.stage : 'queued',
          code: 'internal',
          // The chat shows the message as it is, and its interface speaks Russian.
          message: 'Выполнение сборки прервано. Продолжите её с сохранённых результатов.',
          retryable: true,
        });
        await this.repository.transition(id, 'failed');
      } catch (error) {
        this.logger.warn(`Could not close interrupted run ${id}: ${String(error)}`);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.shutdown.signal.aborted) return;
    const reason = new Error('Generation worker is shutting down.');
    this.shutdown.abort(reason);
    for (const controller of this.active.values()) controller.abort(reason);
    await Promise.allSettled(
      [...this.leases.values()].map((lease) => this.builds.finish(lease, 'interrupted')),
    );
    await this.pool.end();
  }
}

/** The model a request picked, read leniently: a malformed one means the default. */
export function pickedModel(value: unknown): ModelRef | null {
  return modelRefSchema
    .nullable()
    .catch(null)
    .parse(value ?? null);
}
