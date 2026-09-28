import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Logger,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Pool } from 'pg';
import type { z } from 'zod';
import {
  designSystemSchema,
  generationProfileSchema,
  generationRequestSchema,
  modelRefSchema,
  storedTemplateIndexSchema,
  templateIrSchema,
} from '@lct/contracts';
import type { GenerationProfile, StoredTemplateIndex } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import {
  currentTemplateIndexRevision,
  generatePresentation,
  GenerationProvider,
  indexTemplateWithAgent,
  RoutedTextProvider,
} from '@lct/pipeline';
import type { RunRepository } from '@lct/run-store';
import { ModelNotConfiguredError, ModelSettingsService } from '../models/model-settings.service.js';
import { RUN_REPOSITORY } from '../runs/runs.tokens.js';
import { LibraryMetadata } from './library-metadata.js';

/** The renderings of every brief, generated in parallel. */
const VARIANTS = ['dense', 'balanced', 'airy'] as const;

@Controller('generation')
export class GenerationController implements OnApplicationShutdown {
  private readonly root = resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs'));
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly engine = new EngineClient({
    baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 120000,
  });
  private readonly active = new Map<string, AbortController>();
  private readonly library = new LibraryMetadata(this.root);
  private readonly logger = new Logger(GenerationController.name);
  constructor(
    @Inject(RUN_REPOSITORY) private readonly repository: RunRepository,
    @Inject(ModelSettingsService) private readonly models: ModelSettingsService,
  ) {}

  private directory(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new BadRequestException('Invalid run id.');
    return join(this.root, id);
  }

  @Post('prepare')
  async prepare(@Body() body: { templateId?: string; model?: unknown }): Promise<{ ready: true }> {
    const row = await this.template(body.templateId ?? '');
    const profile = await this.engine.generationProfile(row.storage_path);
    await this.pool.query(
      "UPDATE stored_files SET profile = profile || jsonb_build_object('generation', $2::jsonb) WHERE id = $1",
      [body.templateId, JSON.stringify(profile)],
    );
    const model = modelRefSchema
      .nullable()
      .catch(null)
      .parse(body.model ?? null);
    await this.indexTemplate(body.templateId ?? '', profile, row.profile?.index, model);
    return { ready: true };
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
    model: z.infer<typeof modelRefSchema> | null,
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
        (await this.models.resolveRole('planner')) ?? (await this.models.resolve(model));
      const provider = new GenerationProvider({
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl,
        model: resolved.model,
      });
      const index: StoredTemplateIndex = await indexTemplateWithAgent({
        provider,
        registryDir,
        profile,
        signal: AbortSignal.timeout(180000),
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

  private registryDir(): string {
    const found =
      process.env.REGISTRY_DIR ||
      [resolve('registry/agents'), resolve('../../registry/agents')].find(existsSync);
    if (!found) throw new BadRequestException('REGISTRY_DIR is not configured.');
    return found;
  }

  private async template(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid template id.');
    const result = await this.pool.query<{
      storage_path: string;
      profile: { generation?: GenerationProfile; index?: unknown };
    }>("SELECT storage_path, profile FROM stored_files WHERE id = $1 AND kind = 'template'", [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Template not found.');
    return row;
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = generationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    // Every generation runs three variants, each counted as one active run.
    if (this.active.size >= 2 * VARIANTS.length)
      throw new BadRequestException('Two generations are already running.');
    const input = parsed.data;
    if (input.projectId !== null) await this.requireProject(input.projectId);
    const template = await this.template(input.templateId);
    const prepared = generationProfileSchema.safeParse(template.profile?.generation);
    if (!prepared.success) throw new BadRequestException('Prepare the template before generation.');
    let brief = input.brief;
    for (const id of input.contentIds) {
      const files = await this.pool.query<{ storage_path: string }>(
        "SELECT storage_path FROM stored_files WHERE id = $1 AND kind = 'content'",
        [id],
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
    const writer = await settle(this.models.resolve(input.model));
    // Planner and critic run on the models of their roles; a role without one writes with the
    // writer's model, and the slot rewriter always does.
    const [planner, critic] = await settle(
      Promise.all([this.models.resolveRole('planner'), this.models.resolveRole('critic')]),
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
    const runs: {
      run: Awaited<ReturnType<RunRepository['create']>>;
      variant: (typeof VARIANTS)[number];
    }[] = [];
    for (const variant of VARIANTS) {
      const run = await this.repository.create();
      await mkdir(this.directory(run.runId), { recursive: true });
      await writeFile(
        join(this.directory(run.runId), 'metadata.json'),
        JSON.stringify({
          templateId: input.templateId,
          projectId: input.projectId,
          variant,
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
          slideCount: input.slideCount,
          profile: prepared.data,
          ...(notes ? { notes } : {}),
          registryDir,
          engine: this.engine,
          provider,
          seed: input.seed,
          variant,
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
      } catch {
        await this.repository.transition(run.runId, 'failed');
      } finally {
        this.active.delete(run.runId);
      }
    };
    for (const entry of runs) void work(entry).catch(() => undefined);
    const primary = runs.find((entry) => entry.variant === 'balanced') ?? runs[0];
    if (!primary) throw new BadRequestException('No variant could be started.');
    return {
      ...primary.run,
      variants: runs.map(({ run, variant }) => ({ variant, runId: run.runId })),
    };
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    this.active.get(id)?.abort();
    return { ok: true };
  }

  @Get()
  async list(): Promise<unknown[]> {
    await mkdir(this.root, { recursive: true });
    const results: unknown[] = [];
    for (const id of await readdir(this.root)) {
      if (!/^run-[0-9a-f-]{36}$/i.test(id)) continue;
      const run = await this.repository.get(id);
      if (run?.state !== 'done') continue;
      const deck = JSON.parse(await readFile(join(this.directory(id), 'deck.json'), 'utf8'));
      const metadata = JSON.parse(
        await readFile(join(this.directory(id), 'metadata.json'), 'utf8'),
      );
      if (metadata.deletedAt) continue;
      results.push({ deck: { ...deck, title: metadata.title ?? deck.title }, metadata });
    }
    return results;
  }

  @Get(':id/media/:name')
  async media(@Param('id') id: string, @Param('name') name: string): Promise<StreamableFile> {
    if (!/^[-a-zA-Z0-9_.]+\.(png|jpe?g|gif|svg|webp|emf|wmf)$/i.test(name))
      throw new NotFoundException('Unknown media.');
    await this.completed(id);
    const extension = name.split('.').pop()?.toLowerCase();
    const type =
      extension === 'svg'
        ? 'image/svg+xml'
        : extension === 'jpg'
          ? 'image/jpeg'
          : `image/${extension}`;
    return new StreamableFile(await readFile(join(this.directory(id), 'media', name)), { type });
  }

  /**
   * The finished deck for the editor: its design system and template IR, and its slides read back
   * from the .pptx the way they are drawn, with their pictures written next to the run's media.
   * The engine sees the run directory at the same path as the API. When it cannot read the file
   * the answer comes without slides and the editor rebuilds them from the template IR.
   */
  @Get(':id/deck')
  async deck(@Param('id') id: string): Promise<unknown> {
    const metadata = await this.completed(id);
    const directory = this.directory(id);
    const deck = JSON.parse(await readFile(join(directory, 'deck.json'), 'utf8'));
    const pptxPath = join(directory, 'deck.pptx');
    const [current, imported] = await Promise.all([
      this.engine
        .parseTemplateProfile(pptxPath)
        .then((profile) => ({
          designSystem: designSystemSchema.parse(profile.designSystem),
          templateIr: templateIrSchema.parse(profile.templateIr),
        }))
        .catch(() => null),
      this.engine
        .importDeck({ schemaVersion: 1, pptxPath, mediaDir: join(directory, 'media') })
        .then(({ slides }) => ({ slides }))
        .catch((error: unknown) => {
          this.logger.warn(
            `Deck ${id} could not be read back as slides: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }),
    ]);
    return { ...deck, ...current, ...imported, title: metadata.title ?? deck.title };
  }

  @Get(':id/artifacts/:name')
  async artifact(@Param('id') id: string, @Param('name') name: string): Promise<StreamableFile> {
    await this.completed(id);
    const root = this.directory(id);
    let path: string;
    let type: string;
    if (name === 'deck.pptx') {
      path = join(root, name);
      type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    } else if (name === 'deck.pdf') {
      path = join(root, 'previews', name);
      type = 'application/pdf';
    } else if (name === 'manifest.json') {
      path = join(root, name);
      type = 'application/json';
    } else if (name === 'slides.zip') {
      path = join(root, name);
      type = 'application/zip';
    } else if (/^slide-\d+\.png$/.test(name)) {
      // pdftoppm pads the page number to the width of the page count: slide-01.png in a deck of
      // ten or more. A slide is asked for by its number, however the file spells it.
      const number = Number(/\d+/.exec(name)?.[0]);
      const found = (await readdir(join(root, 'previews'))).find(
        (file) => /^slide-\d+\.png$/.test(file) && Number(/\d+/.exec(file)?.[0]) === number,
      );
      if (!found) throw new NotFoundException('Artifact not found.');
      path = join(root, 'previews', found);
      type = 'image/png';
    } else throw new NotFoundException('Artifact not found.');
    return new StreamableFile(await readFile(path), {
      type,
      disposition: `attachment; filename="${basename(path)}"`,
    });
  }

  @Get(':id/previews')
  async previews(@Param('id') id: string): Promise<string[]> {
    await this.completed(id);
    return (await readdir(join(this.directory(id), 'previews'))).filter((name) =>
      /^slide-\d+\.png$/.test(name),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    await this.pool.end();
  }

  private async requireProject(id: string): Promise<void> {
    if (!(await this.pool.query('SELECT id FROM library_projects WHERE id = $1', [id])).rowCount)
      throw new NotFoundException('Project not found.');
  }

  private async completed(id: string) {
    const run = await this.repository.get(id);
    if (run?.state !== 'done' || !(await this.library.visible(id)))
      throw new NotFoundException('Completed deck not found.');
    return this.library.read(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    const run = await this.repository.get(id);
    if (run?.state !== 'done') throw new NotFoundException('Completed deck not found.');
    await this.library.remove(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { title?: unknown; projectId?: unknown }) {
    await this.completed(id);
    if (!body || typeof body !== 'object') throw new BadRequestException('Invalid deck patch.');
    const patch: { title?: string; projectId?: string | null } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200)
        throw new BadRequestException('Invalid title.');
      patch.title = body.title.trim();
    }
    if (body.projectId !== undefined) {
      if (body.projectId !== null && typeof body.projectId !== 'string')
        throw new BadRequestException('Invalid project id.');
      if (typeof body.projectId === 'string') await this.requireProject(body.projectId);
      patch.projectId = body.projectId;
    }
    if (!Object.keys(patch).length) throw new BadRequestException('Empty deck patch.');
    await this.library.patch(id, patch);
    return { ok: true };
  }
}
