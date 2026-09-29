import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import {
  generationProfileSchema,
  modelRefSchema,
  storedTemplateIndexSchema,
  type GenerationProfile,
  type GenerationRequest,
  type LayoutVariant,
  type ModelRef,
  type StoredTemplateIndex,
} from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import {
  currentTemplateIndexRevision,
  generatePresentation,
  GenerationProvider,
  indexTemplateWithAgent,
  RoutedTextProvider,
  SharedPlan,
  SharedIllustrations,
  OpenAICompatibleImageProvider,
  FakeImageProvider,
  type ImageProvider,
  type IndexProgress,
} from '@lct/pipeline';
import type { RunRepository } from '@lct/run-store';
import { ModelNotConfiguredError, ModelSettingsService } from '../models/model-settings.service.js';
import { RUN_REPOSITORY } from '../runs/runs.tokens.js';
import { LibraryMetadata } from './library-metadata.js';
import type { Account } from '../accounts/account-rules.js';
import { visibleFile } from '../files/template-visibility.js';

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

/**
 * The revision of the engine's generation profile. Raise it when the engine reads something new
 * from a template, so templates prepared before are read again: 2 added places for pictures.
 */
export const PROFILE_REVISION = 2;

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
): ImageProvider | null {
  if (env.IMAGE_PROVIDER === 'fake') return new FakeImageProvider();
  if (assigned) return new OpenAICompatibleImageProvider(assigned);
  if (env.IMAGE_BASE_URL && env.IMAGE_MODEL)
    return new OpenAICompatibleImageProvider({
      baseUrl: env.IMAGE_BASE_URL,
      apiKey: env.MODEL_API_KEY ?? '',
      model: env.IMAGE_MODEL,
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
  readonly library = new LibraryMetadata(this.root);
  private readonly logger = new Logger(GenerationService.name);
  /** Templates being prepared right now, and how far each has got. */
  private readonly preparing = new Map<string, PrepareProgress>();
  /** Templates whose slides are being drawn right now: a second request does not start again. */
  private readonly drawing = new Set<string>();

  constructor(
    @Inject(RUN_REPOSITORY) readonly repository: RunRepository,
    @Inject(ModelSettingsService) private readonly models: ModelSettingsService,
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
      if (
        previous.success &&
        previous.data.templateHash === profile.templateHash &&
        previous.data.revision === revision
      )
        return;
      const resolved =
        (await this.models.resolveRole('planner', actorOf(account))) ??
        (await this.models.resolve(model, actorOf(account)));
      const provider = new GenerationProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
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

  async requireProject(id: string, account: Account): Promise<void> {
    const found = await this.pool.query(
      'SELECT id FROM library_projects WHERE id = $1 AND owner_id = $2',
      [id, account.id],
    );
    if (!found.rowCount) throw new NotFoundException('Project not found.');
  }

  /** Stop a build: its variants share one cancellation, so any of their runs stops all three. */
  cancel(runId: string): void {
    this.active.get(runId)?.abort();
  }

  /**
   * Start the three variants of a brief. They run in the background; `settled` tells how each
   * ended. With an outline the planner lays out its slides, and their number is the outline's.
   */
  /** Whether a build of this person gets pictures: an image model is assigned or configured. */
  async imagesAvailable(account: Account): Promise<boolean> {
    return imageProviderOf(await this.models.resolveRole('image', actorOf(account))) !== null;
  }

  async start(input: GenerationRequest, account: Account): Promise<StartedBuild> {
    // Every generation runs three variants, each counted as one active run.
    if (this.active.size >= 2 * VARIANTS.length)
      throw new BadRequestException('Two generations are already running.');
    if (input.projectId !== null) await this.requireProject(input.projectId, account);
    const template = await this.template(input.templateId, account);
    const prepared = generationProfileSchema.safeParse(template.profile?.generation);
    if (!prepared.success) throw new BadRequestException('Prepare the template before generation.');
    let brief = input.brief;
    for (const id of input.contentIds) {
      const files = await this.pool.query<{ storage_path: string }>(
        `SELECT storage_path FROM stored_files
         WHERE id = $1 AND kind = 'content' AND ${visibleFile(2)}`,
        [id, account.id],
      );
      const path = files.rows[0]?.storage_path;
      if (!path || !/\.(txt|md|csv|tsv)$/i.test(path))
        throw new BadRequestException(
          'This generation supports text, Markdown and CSV/TSV content.',
        );
      const content = await readFile(path, 'utf8');
      brief += `\n\nSource ${id}:\n${content}`;
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
    const writer = await settle(this.models.resolve(input.model, actor));
    // Planner and critic run on the models of their roles; a role without one writes with the
    // writer's model, and the slot rewriter always does.
    const [planner, critic] = await settle(
      Promise.all([
        this.models.resolveRole('planner', actor),
        this.models.resolveRole('critic', actor),
      ]),
    );
    const providerOf = (model: { apiKey: string; baseUrl: string; model: string }) =>
      new GenerationProvider({
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        model: model.model,
        seed: input.seed,
      });
    const fallback = providerOf(writer);
    const provider = new RoutedTextProvider(
      fallback,
      new Map([
        ['writer', fallback],
        ['rewriter', fallback],
        ...(planner ? [['planner', providerOf(planner)] as const] : []),
        ...(critic ? [['critic', providerOf(critic)] as const] : []),
      ]),
    );
    const registryDir = this.registryDir();
    const index = storedTemplateIndexSchema.safeParse(template.profile?.index);
    // Notes describe the profile they were made from; a re-parsed template drops stale ones.
    const notes =
      index.success && index.data.templateHash === prepared.data.templateHash
        ? index.data.notes
        : undefined;
    // The three variants of one brief are separate runs, so every deck endpoint serves each of
    // them as it is, and they share one cancellation.
    const controller = new AbortController();
    // One plan for the three variants: the story is decided once, the layouts per variant.
    const sharedPlan = new SharedPlan();
    // Pictures too are drawn once per brief. Without an image model the planner is not offered
    // a place for a picture, so no slide is left with an empty frame.
    const imageModel = await settle(this.models.resolveRole('image', actor));
    const images = imageProviderOf(imageModel);
    const illustrations = images
      ? await SharedIllustrations.load(
          {
            images,
            text: provider,
            designSystem: prepared.data.designSystem,
            seed: input.seed ?? 42,
            signal: controller.signal,
          },
          registryDir,
        )
      : null;
    const runs: {
      run: Awaited<ReturnType<RunRepository['create']>>;
      variant: LayoutVariant;
    }[] = [];
    // The variants are one build: the library shows it once.
    const buildId = randomUUID();
    for (const variant of VARIANTS) {
      const run = await this.repository.create();
      await mkdir(this.directory(run.runId), { recursive: true });
      await writeFile(
        join(this.directory(run.runId), 'metadata.json'),
        JSON.stringify({
          templateId: input.templateId,
          projectId: input.projectId,
          ownerId: account.id,
          variant,
          buildId,
          updatedAt: Date.now(),
        }),
      );
      this.active.set(run.runId, controller);
      runs.push({ run, variant });
    }
    const work = async ({ run, variant }: (typeof runs)[number]) => {
      try {
        await this.repository.transition(run.runId, 'running');
        await generatePresentation({
          runId: run.runId,
          templatePath: template.storage_path,
          outputDir: this.directory(run.runId),
          brief,
          slideCount: input.outline ? null : input.slideCount,
          outline: input.outline,
          profile: prepared.data,
          ...(notes ? { notes } : {}),
          registryDir,
          engine: this.engine,
          provider,
          seed: input.seed,
          variant,
          sharedPlan,
          illustrations,
          signal: controller.signal,
          onEvent: (event) => this.repository.appendEvent(run.runId, event),
        });
        if (input.projectId !== null) {
          const project = await this.pool.query(
            'UPDATE library_projects SET updated_at = now() WHERE id = $1 RETURNING id',
            [input.projectId],
          );
          if (!project.rowCount) await this.library.remove(run.runId);
        }
        await this.repository.transition(run.runId, 'done');
        return 'done' as const;
      } catch {
        await this.repository.transition(run.runId, 'failed').catch(() => undefined);
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
    const settled = Promise.all(each);
    const primary = runs.find((entry) => entry.variant === 'balanced') ?? runs[0];
    if (!primary) throw new BadRequestException('No variant could be started.');
    return {
      runId: primary.run.runId,
      variants: runs.map(({ run, variant }) => ({ variant, runId: run.runId })),
      each,
      settled,
    };
  }

  /**
   * A generation lives in this process, so one still queued or running at start was cut short by
   * a restart and will not go on. It is failed with a reason, and the chat that follows it offers
   * to build again instead of waiting for it. The API runs as a single instance.
   */
  async onApplicationBootstrap(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    for (const id of await readdir(this.root)) {
      if (!/^run-[0-9a-f-]{36}$/i.test(id) || this.active.has(id)) continue;
      try {
        const run = await this.repository.get(id);
        if (run?.state !== 'queued' && run?.state !== 'running') continue;
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
          message: 'Сервер перезапустился во время сборки. Запустите её ещё раз.',
          retryable: true,
        });
        await this.repository.transition(id, 'failed');
      } catch (error) {
        this.logger.warn(`Could not close interrupted run ${id}: ${String(error)}`);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
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
