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
  StreamableFile,
} from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { generationProfileSchema, generationRequestSchema } from '@lct/contracts';
import type { GenerationProfile } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation, OpenAICompatibleProvider } from '@lct/pipeline';
import type { RunRepository } from '@lct/run-store';
import { RUN_REPOSITORY } from '../runs/runs.tokens.js';
import { LibraryMetadata } from './library-metadata.js';

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
  constructor(@Inject(RUN_REPOSITORY) private readonly repository: RunRepository) {}

  private directory(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new BadRequestException('Invalid run id.');
    return join(this.root, id);
  }

  @Post('prepare')
  async prepare(@Body() body: { templateId?: string }): Promise<{ ready: true }> {
    const row = await this.template(body.templateId ?? '');
    const profile = await this.engine.generationProfile(row.storage_path);
    await this.pool.query(
      "UPDATE stored_files SET profile = profile || jsonb_build_object('generation', $2::jsonb) WHERE id = $1",
      [body.templateId, JSON.stringify(profile)],
    );
    return { ready: true };
  }

  private async template(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid template id.');
    const result = await this.pool.query<{
      storage_path: string;
      profile: { generation?: GenerationProfile };
    }>("SELECT storage_path, profile FROM stored_files WHERE id = $1 AND kind = 'template'", [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Template not found.');
    return row;
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed = generationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    if (this.active.size >= 2)
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
    const provider = new OpenAICompatibleProvider({
      apiKey: process.env.MODEL_API_KEY ?? '',
      baseUrl: process.env.LLM_BASE_URL ?? '',
      model: process.env.LLM_MODEL ?? '',
      seed: input.seed,
    });
    const run = await this.repository.create();
    await mkdir(this.directory(run.runId), { recursive: true });
    await writeFile(
      join(this.directory(run.runId), 'metadata.json'),
      JSON.stringify({
        templateId: input.templateId,
        projectId: input.projectId,
        updatedAt: Date.now(),
      }),
    );
    const controller = new AbortController();
    this.active.set(run.runId, controller);
    const registryDir =
      process.env.REGISTRY_DIR ||
      [resolve('registry/agents'), resolve('../../registry/agents')].find(existsSync);
    if (!registryDir) {
      this.active.delete(run.runId);
      await this.repository.transition(run.runId, 'failed');
      throw new BadRequestException('REGISTRY_DIR is not configured.');
    }
    const work = async () => {
      try {
        await this.repository.transition(run.runId, 'running');
        await generatePresentation({
          runId: run.runId,
          templatePath: template.storage_path,
          outputDir: this.directory(run.runId),
          brief,
          slideCount: input.slideCount,
          profile: prepared.data,
          registryDir,
          engine: this.engine,
          provider,
          seed: input.seed,
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
    void work().catch(() => undefined);
    return run;
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

  @Get(':id/deck')
  async deck(@Param('id') id: string): Promise<unknown> {
    const metadata = await this.completed(id);
    const deck = JSON.parse(await readFile(join(this.directory(id), 'deck.json'), 'utf8'));
    return { ...deck, title: metadata.title ?? deck.title };
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
    } else if (/^slide-\d+\.png$/.test(name)) {
      path = join(root, 'previews', name);
      type = 'image/png';
    } else throw new NotFoundException('Artifact not found.');
    return new StreamableFile(await readFile(path), {
      type,
      disposition: `inline; filename="${basename(path)}"`,
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
