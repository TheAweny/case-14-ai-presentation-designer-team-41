import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Get,
  Inject,
  Optional,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  designSystemSchema,
  deckImportResponseSchema,
  generationRequestSchema,
  templateIrSchema,
} from '@lct/contracts';
import type { SlideIr } from '@lct/contracts';
import { currentTemplateIndexRevision, templateIndexState } from '@lct/pipeline';
import { validateExportMedia, writeExportMedia } from './export-media.js';
import { buildOf, oneDeckPerBuild, type Metadata } from './library-metadata.js';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { GenerationService, pickedModel, type PrepareProgress } from './generation.service.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { ApiAccountRoutes, ApiErrors, ApiFile, ApiJsonBody } from '../docs/decorators.js';
import {
  deckPatchSchema,
  deckSummarySchema,
  exportRequestSchema,
  exportedDeckSchema,
  libraryDeckSchema,
  okSchema,
  prepareRequestSchema,
  startedBuildSchema,
  templatePreparationSchema,
} from '../docs/schemas.js';

const RUN_ID = 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40';
const TEMPLATE_ID = '11d8fefa-d032-4a95-84e5-77efd69569c2';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const deckParam = ApiParam({
  name: 'id',
  description: 'id готового варианта колоды.',
  example: RUN_ID,
});

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
  readiness?: {
    index: 'missing' | 'partial' | 'stale' | 'ready';
    geometry: boolean;
    fonts: 'ready' | 'missing' | 'unknown';
    compositions: number;
    textSlots: number;
    imageSlots: number;
  };
}

@Controller('generation')
@ApiAccountRoutes('generation')
export class GenerationController {
  private readonly logger = new Logger(GenerationController.name);
  constructor(
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Optional() @Inject(AccountUsageService) private readonly accountUsage?: AccountUsageService,
  ) {}

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
  @ApiOperation({
    summary: 'Подготовить шаблон',
    description:
      'Один раз на шаблон и вне бюджета генерации: профиль, описание каждого макета моделью и превью слайдов. Отвечает, когда шаблон готов; повторный вызов для готового шаблона возвращается сразу.',
  })
  @ApiJsonBody(prepareRequestSchema, { 'Шаблон из библиотеки': { templateId: TEMPLATE_ID } })
  @ApiCreatedResponse({
    standardSchema: z.object({ ready: z.literal(true) }),
    example: { ready: true },
  })
  @ApiErrors(400, 404, 503)
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
  @ApiOperation({
    summary: 'Ход подготовки шаблона',
    description:
      'Этап и сколько макетов описано; страница, открытая посреди подготовки, следит за ней.',
  })
  @ApiParam({ name: 'templateId', example: TEMPLATE_ID })
  @ApiOkResponse({
    standardSchema: templatePreparationSchema,
    example: {
      stage: 'index',
      described: 7,
      total: 18,
      indexed: false,
      drawing: true,
      drawn: false,
    },
  })
  @ApiErrors(400, 404)
  async preparation(
    @Param('templateId') templateId: string,
    @CurrentAccount() account: Account,
  ): Promise<TemplatePreparation> {
    const row = await this.generation.template(templateId, account);
    const { progress, drawing } = this.generation.preparationOf(templateId);
    const profile = row.profile.generation;
    const index = profile
      ? templateIndexState(
          profile,
          row.profile.index,
          await currentTemplateIndexRevision(this.generation.registryDir()),
        )
      : 'missing';
    return {
      stage: progress?.stage ?? null,
      described: progress?.described ?? 0,
      total: progress?.total ?? 0,
      indexed: index === 'ready',
      drawing,
      drawn: Array.isArray(row.profile?.previews),
      ...(profile
        ? {
            readiness: {
              index,
              geometry: profile.compositions.every((composition) =>
                composition.slots.every((slot) => slot.box !== undefined),
              ),
              fonts: profile.fontReadiness?.state ?? 'unknown',
              compositions: profile.compositions.length,
              textSlots: profile.compositions.reduce(
                (sum, composition) => sum + composition.slots.length,
                0,
              ),
              imageSlots: profile.compositions.reduce(
                (sum, composition) => sum + (composition.imageSlots?.length ?? 0),
                0,
              ),
            },
          }
        : {}),
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Собрать колоду',
    description:
      'Запускает три варианта вёрстки (`dense`, `balanced`, `airy`) по одному плану. Ответ приходит сразу; ход каждого варианта — в `GET /runs/{runId}/events`. Бюджет на три варианта — 5 минут.',
  })
  @ApiJsonBody(generationRequestSchema, {
    'Колода по брифу': {
      templateId: TEMPLATE_ID,
      brief:
        'Итоги третьего квартала для совета директоров: выручка выросла на 18 %, отток упал до 4 %, запустили два продукта. Нужны выводы и план на четвёртый квартал.',
      slideCount: 12,
      contentIds: ['3c9e1b7a-5d2f-4e8a-b6c4-0f1a2d3e4b5c'],
    },
  })
  @ApiCreatedResponse({
    standardSchema: startedBuildSchema,
    example: {
      runId: RUN_ID,
      state: 'queued',
      createdAt: '2026-10-16T10:00:00.000Z',
      updatedAt: '2026-10-16T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
      variants: [
        { variant: 'dense', runId: 'run-5e2a7c9f-1b3d-4e6f-8a0c-2d4f6b8e0a1c' },
        { variant: 'balanced', runId: RUN_ID },
        { variant: 'airy', runId: 'run-9c1d3f5b-7a9e-4c2d-b4f6-8e0a2c4e6f8b' },
      ],
    },
  })
  @ApiErrors(400, 404, 503)
  async create(@Body() body: unknown, @CurrentAccount() account: Account) {
    const parsed = generationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const build = await this.generation.start(parsed.data, account);
    const run = await this.repository.get(build.runId);
    return { ...run, runId: build.runId, variants: build.variants };
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Остановить сборку',
    description: 'Варианты, которые ещё идут, прерываются.',
  })
  @deckParam
  @ApiCreatedResponse({ standardSchema: okSchema, example: { ok: true } })
  @ApiErrors(404)
  async cancel(@Param('id') id: string, @CurrentAccount() account: Account) {
    if (!(await this.library.visible(id, account.id)))
      throw new NotFoundException('Run not found.');
    await this.generation.cancel(id);
    return { ok: true };
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Накопленный расход сборки, включая неудачные попытки и продолжения' })
  async usage(@Param('id') id: string, @CurrentAccount() account: Account) {
    return this.generation.usage(id, account);
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Продолжить сборку с сохранённых задач' })
  async resume(@Param('id') id: string, @CurrentAccount() account: Account) {
    const build = await this.generation.resume(id, account);
    return { runId: build.runId, variants: build.variants };
  }

  @Get()
  @ApiOperation({
    summary: 'Колоды библиотеки',
    description: 'Одна запись на сборку: вариант, выбранный в чате, или первый готовый.',
  })
  @ApiOkResponse({ standardSchema: z.array(libraryDeckSchema) })
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
  @ApiOperation({ summary: 'Картинка колоды', description: 'Изображения слайдов для редактора.' })
  @deckParam
  @ApiParam({ name: 'name', example: 'image-4.png' })
  @ApiFile('Изображение.', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp')
  @ApiErrors(404)
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
   * The saved generation result for chat cards. Its cover is already rendered; opening the card
   * must not parse and import three PPTX files again just to display those covers.
   */
  @Get(':id/summary')
  @ApiOperation({
    summary: 'Сводка колоды для карточки чата',
    description: 'Без повторного чтения `.pptx`: обложка уже нарисована.',
  })
  @deckParam
  @ApiOkResponse({ standardSchema: deckSummarySchema })
  @ApiErrors(404)
  async summary(@Param('id') id: string, @CurrentAccount() account: Account): Promise<unknown> {
    const metadata = await this.completed(id, account);
    const deck = JSON.parse(await readFile(join(this.directory(id), 'deck.json'), 'utf8'));
    return { ...deck, title: metadata.title ?? deck.title };
  }

  /**
   * The finished deck for the editor: its design system and template IR, and its slides read back
   * from the .pptx the way they are drawn, with their pictures written next to the run's media.
   * The engine sees the run directory at the same path as the API. When it cannot read the file
   * the answer comes without slides and the editor rebuilds them from the template IR.
   */
  @Get(':id/deck')
  @ApiOperation({
    summary: 'Колода для редактора',
    description:
      'Дизайн-система, IR шаблона и слайды, прочитанные обратно из `.pptx`. Если движок не смог прочитать файл, `slides` нет и редактор собирает их из IR шаблона.',
  })
  @deckParam
  @ApiOkResponse({
    standardSchema: deckSummarySchema.extend({
      slides: deckImportResponseSchema.shape.slides.optional(),
    }),
  })
  @ApiErrors(404)
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
  @ApiOperation({
    summary: 'Скачать артефакт сборки',
    description: 'Файл, каким его собрал пайплайн.',
  })
  @deckParam
  @ApiParam({
    name: 'name',
    enum: ['deck.pptx', 'deck.pdf', 'manifest.json', 'slides.zip', 'slide-1.png'],
    description: '`slide-N.png` — превью слайда N.',
  })
  @ApiFile('Артефакт.', PPTX, 'application/pdf', 'application/json', 'application/zip', 'image/png')
  @ApiErrors(404)
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

  /**
   * The edited deck the user sees in the editor is drawn again as a native PPTX (plus PDF and
   * slide previews on request), so the download reproduces exactly what the editor shows.
   */
  @Post(':id/export')
  @ApiOperation({
    summary: 'Экспорт отредактированной колоды',
    description:
      'Движок заново собирает нативный PPTX из слайдов редактора, поэтому скачанный файл совпадает с тем, что на экране. PDF, PNG и HTML строятся из него же. Файлы — в `GET /generation/{id}/exports/{exportId}/{name}`.',
  })
  @deckParam
  @ApiJsonBody(exportRequestSchema)
  @ApiCreatedResponse({
    standardSchema: exportedDeckSchema,
    example: { exportId: '7d3f9a1c-2b4e-4c6d-8e0f-1a2b3c4d5e6f', previews: [] },
  })
  @ApiErrors(400, 404, 503)
  async exportEdited(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ): Promise<{ exportId: string; previews: string[] }> {
    await this.completed(id, account);
    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const request = parsed.data;
    const slides = request.slides;
    const validatedMedia = validateExportMedia(slides, request.media);
    const variant = request.variant ?? 'balanced';
    // The requested download decides what the engine builds: a PPTX pays for neither PDF nor
    // previews, PDF skips previews, PNG and HTML are built from the rendered previews.
    const format =
      request.format === 'pdf' || request.format === 'png' || request.format === 'html'
        ? request.format
        : 'pptx';
    const formats: ('pptx' | 'pdf')[] = format === 'pdf' ? ['pptx', 'pdf'] : ['pptx'];
    const previews = format === 'png' || format === 'html';
    const exportId = randomUUID();
    const outputDir = join(this.directory(id), 'exports', exportId);
    if (this.accountUsage)
      return this.accountUsage.write(
        account.id,
        0,
        () =>
          this.buildEditedExport(
            id,
            slides,
            validatedMedia,
            variant,
            format,
            formats,
            previews,
            exportId,
            outputDir,
          ),
        () => rm(outputDir, { recursive: true, force: true }),
      );
    return this.buildEditedExport(
      id,
      slides,
      validatedMedia,
      variant,
      format,
      formats,
      previews,
      exportId,
      outputDir,
    );
  }
  private async buildEditedExport(
    id: string,
    slides: readonly SlideIr[],
    validatedMedia: ReturnType<typeof validateExportMedia>,
    variant: 'dense' | 'balanced' | 'airy',
    format: string,
    formats: ('pptx' | 'pdf')[],
    previews: boolean,
    exportId: string,
    outputDir: string,
  ): Promise<{ exportId: string; previews: string[] }> {
    await mkdir(outputDir, { recursive: true });
    try {
      const media = await writeExportMedia(outputDir, validatedMedia);
      await this.engine.exportDeck({
        schemaVersion: 1,
        templatePath: join(this.directory(id), 'deck.pptx'),
        variant,
        slides: slides as SlideIr[],
        outputDir,
        formats,
        previews,
        media,
      });
      await rename(join(outputDir, `${variant}.pptx`), join(outputDir, 'deck.pptx'));
      if (format === 'pdf')
        await rename(join(outputDir, `${variant}.pdf`), join(outputDir, 'deck.pdf'));
      const previewNames = previews
        ? (await readdir(join(outputDir, 'previews'))).filter((name) =>
            /^slide-\d+\.png$/.test(name),
          )
        : [];
      if (previews && !previewNames.length) throw new Error('Engine produced no export previews.');
      return { exportId, previews: previewNames };
    } catch (error) {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Edited deck export failed.',
      );
    }
  }

  @Get(':id/exports/:exportId/:name')
  @ApiOperation({
    summary: 'Скачать экспорт',
    description: 'Файл, собранный `POST /generation/{id}/export`.',
  })
  @deckParam
  @ApiParam({ name: 'exportId', example: '7d3f9a1c-2b4e-4c6d-8e0f-1a2b3c4d5e6f' })
  @ApiParam({ name: 'name', enum: ['deck.pptx', 'deck.pdf', 'slide-1.png'] })
  @ApiFile('Файл экспорта.', PPTX, 'application/pdf', 'image/png')
  @ApiErrors(404)
  async editedArtifact(
    @Param('id') id: string,
    @Param('exportId') exportId: string,
    @Param('name') name: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    await this.completed(id, account);
    if (!/^[0-9a-f-]{36}$/i.test(exportId) || !/^(deck\.(pptx|pdf)|slide-\d+\.png)$/.test(name))
      throw new NotFoundException('Artifact not found.');
    const root = join(this.directory(id), 'exports', exportId);
    const path = name.startsWith('slide-') ? join(root, 'previews', name) : join(root, name);
    if (!existsSync(path)) throw new NotFoundException('Artifact not found.');
    const type = name.endsWith('.pptx')
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : name.endsWith('.pdf')
        ? 'application/pdf'
        : 'image/png';
    return new StreamableFile(await readFile(path), {
      type,
      disposition: `attachment; filename="${name}"`,
    });
  }

  @Get(':id/previews')
  @ApiOperation({
    summary: 'Превью слайдов',
    description: 'Имена файлов; сами файлы — в `artifacts`.',
  })
  @deckParam
  @ApiOkResponse({ standardSchema: z.array(z.string()), example: ['slide-01.png', 'slide-02.png'] })
  @ApiErrors(404)
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
  @ApiOperation({
    summary: 'Удалить колоду',
    description: 'Вместе с остальными вариантами сборки.',
  })
  @deckParam
  @ApiNoContentResponse({ description: 'Колода удалена.' })
  @ApiErrors(404)
  async remove(@Param('id') id: string, @CurrentAccount() account: Account): Promise<void> {
    await this.completed(id, account);
    // A deck in the library stands for its build: the other variants go with it.
    for (const deck of await this.library.build(id)) await this.library.remove(deck);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Переименовать или перенести колоду',
    description: 'Все варианты сборки меняются вместе. `projectId: null` — вынести из проекта.',
  })
  @deckParam
  @ApiJsonBody(deckPatchSchema, {
    Переименовать: { title: 'Итоги квартала' },
    'Вынести из проекта': { projectId: null },
  })
  @ApiOkResponse({ standardSchema: okSchema, example: { ok: true } })
  @ApiErrors(400, 404)
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
