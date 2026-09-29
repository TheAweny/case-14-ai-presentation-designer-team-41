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
  StreamableFile,
} from '@nestjs/common';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  designSystemSchema,
  generationRequestSchema,
  storedTemplateIndexSchema,
  templateIrSchema,
} from '@lct/contracts';
import { buildOf, oneDeckPerBuild, type Metadata } from './library-metadata.js';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { GenerationService, pickedModel, type PrepareProgress } from './generation.service.js';

/** What `GET /generation/prepare/:templateId` answers. */
export interface TemplatePreparation {
  /** The stage of a preparation under way; `null` — none runs. */
  stage: PrepareProgress['stage'] | null;
  /** Compositions described so far, of `total`; both 0 until indexing starts. */
  described: number;
  total: number;
  /** The template has notes of the indexer. */
  indexed: boolean;
  /** Its slides are being drawn right now; `drawn` — the pictures are there. */
  drawing: boolean;
  drawn: boolean;
}

@Controller('generation')
export class GenerationController {
  private readonly logger = new Logger(GenerationController.name);
  constructor(@Inject(GenerationService) private readonly generation: GenerationService) {}

  private get pool() {
    return this.generation.pool;
  }
  private get engine() {
    return this.generation.engine;
  }
  private get library() {
    return this.generation.library;
  }
  private get repository() {
    return this.generation.repository;
  }
  private get root() {
    return this.generation.root;
  }
  private directory(id: string): string {
    return this.generation.directory(id);
  }

  @Post('prepare')
  async prepare(
    @Body() body: { templateId?: string; model?: unknown },
    @CurrentAccount() account: Account,
  ): Promise<{ ready: true }> {
    await this.generation.prepare(body.templateId ?? '', pickedModel(body.model), account);
    return { ready: true };
  }

  /**
   * How far the preparation of a template has got, for the library to show while it waits: the
   * stage and the compositions described so far, and whether the slides are drawn. A page that
   * opens while a preparation runs follows it instead of starting another.
   */
  @Get('prepare/:templateId')
  async preparation(
    @Param('templateId') templateId: string,
    @CurrentAccount() account: Account,
  ): Promise<TemplatePreparation> {
    const row = await this.generation.template(templateId, account);
    const { progress, drawing } = this.generation.preparationOf(templateId);
    return {
      stage: progress?.stage ?? null,
      described: progress?.described ?? 0,
      total: progress?.total ?? 0,
      indexed: storedTemplateIndexSchema.safeParse(row.profile?.index).success,
      drawing,
      drawn: Array.isArray(row.profile?.previews),
    };
  }

  @Post()
  async create(@Body() body: unknown, @CurrentAccount() account: Account) {
    const parsed = generationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const build = await this.generation.start(parsed.data, account);
    const run = await this.repository.get(build.runId);
    return { ...run, runId: build.runId, variants: build.variants };
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @CurrentAccount() account: Account) {
    if (!(await this.library.visible(id, account.id)))
      throw new NotFoundException('Run not found.');
    this.generation.cancel(id);
    return { ok: true };
  }

  @Get()
  async list(@CurrentAccount() account: Account): Promise<unknown[]> {
    await mkdir(this.root, { recursive: true });
    // A deck leads back to the chat it was generated in, and the variant the chat settled on
    // stands for its build.
    const chats = await this.pool.query<{
      id: string;
      deck_ids: string[];
      primary: string | null;
    }>('SELECT id, deck_ids, primary_deck_id AS primary FROM chats WHERE owner_id = $1', [
      account.id,
    ]);
    const chatOf = new Map(
      chats.rows.flatMap((chat) => chat.deck_ids.map((deck) => [deck, chat.id])),
    );
    const chosen = new Set(chats.rows.flatMap((chat) => (chat.primary ? [chat.primary] : [])));
    const finished: { id: string; metadata: Metadata }[] = [];
    for (const id of await readdir(this.root)) {
      if (!/^run-[0-9a-f-]{36}$/i.test(id)) continue;
      const run = await this.repository.get(id);
      if (run?.state !== 'done') continue;
      const metadata = JSON.parse(
        await readFile(join(this.directory(id), 'metadata.json'), 'utf8'),
      ) as Metadata;
      if (metadata.deletedAt || metadata.ownerId !== account.id) continue;
      finished.push({ id, metadata });
    }
    const results: unknown[] = [];
    for (const entry of oneDeckPerBuild(finished, chosen)) {
      const { id, metadata } = entry;
      const deck = JSON.parse(await readFile(join(this.directory(id), 'deck.json'), 'utf8'));
      results.push({
        deck: { ...deck, title: metadata.title ?? deck.title },
        metadata: {
          ...metadata,
          chatId: chatOf.get(id) ?? null,
          // Every finished variant of the build: the web finds the build by any of them.
          variants: finished
            .filter((other) => buildOf(other) === buildOf(entry))
            .map((other) => other.id),
        },
      });
    }
    return results;
  }

  @Get(':id/media/:name')
  async media(
    @Param('id') id: string,
    @Param('name') name: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    if (!/^[-a-zA-Z0-9_.]+\.(png|jpe?g|gif|svg|webp|emf|wmf)$/i.test(name))
      throw new NotFoundException('Unknown media.');
    await this.completed(id, account);
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
  async deck(@Param('id') id: string, @CurrentAccount() account: Account): Promise<unknown> {
    const metadata = await this.completed(id, account);
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
  async artifact(
    @Param('id') id: string,
    @Param('name') name: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    await this.completed(id, account);
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
  async previews(@Param('id') id: string, @CurrentAccount() account: Account): Promise<string[]> {
    await this.completed(id, account);
    return (await readdir(join(this.directory(id), 'previews'))).filter((name) =>
      /^slide-\d+\.png$/.test(name),
    );
  }

  /** The finished deck of this account; another account's is answered as missing. */
  private async completed(id: string, account: Account) {
    const run = await this.repository.get(id);
    if (run?.state !== 'done' || !(await this.library.visible(id, account.id)))
      throw new NotFoundException('Completed deck not found.');
    return this.library.read(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    await this.completed(id, account);
    // A deck in the library stands for its build: the other variants go with it.
    for (const deck of await this.library.build(id)) await this.library.remove(deck);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { title?: unknown; projectId?: unknown },
    @CurrentAccount() account: Account,
  ) {
    await this.completed(id, account);
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
      if (typeof body.projectId === 'string')
        await this.generation.requireProject(body.projectId, account);
      patch.projectId = body.projectId;
    }
    if (!Object.keys(patch).length) throw new BadRequestException('Empty deck patch.');
    // The variants of a build are renamed and moved together, so the build stays one deck.
    for (const deck of await this.library.build(id)) await this.library.patch(deck, patch);
    return { ok: true };
  }
}
