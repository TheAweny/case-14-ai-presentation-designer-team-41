import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { LayoutVariantName, SlideIr } from '@lct/contracts';
import {
  editorMediaPutRequestSchema,
  editorRevisionExportRequestSchema,
  editorSnapshotSaveRequestSchema,
  type EditorMediaRef,
  type EditorRevisionExportResponse,
  type EditorSnapshot,
  type EditorSnapshotLoad,
  type EditorSnapshotSaveResponse,
} from '@lct/contracts';
import type { Account } from '../accounts/account-rules.js';
import { writeExportMedia, type ValidatedExportMedia } from '../generation/export-media.js';
import { GenerationService } from '../generation/generation.service.js';
import { decodeEditorMedia } from './editor-media.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import {
  EditorMediaConflictError,
  EditorMediaMissingError,
  EditorRevisionError,
  PostgresEditorSnapshotStore,
  type EditorSnapshotStore,
} from './snapshot-store.js';

const variantSchema = z.enum(['dense', 'balanced', 'airy']);

/**
 * Revisioned editor snapshots for one account. Picture bytes stay on disk. A save is published
 * only after every picture it names is already stored. Export reads one revision and does not
 * call a model.
 */
@Injectable()
export class EditorService implements OnApplicationBootstrap {
  private readonly store: EditorSnapshotStore;

  constructor(
    @Inject(GenerationService) private readonly generation: GenerationService,
    @Optional() @Inject(AccountUsageService) private readonly usage?: AccountUsageService,
  ) {
    this.store = new PostgresEditorSnapshotStore(
      this.generation.pool,
      join(this.generation.root, 'editor-media'),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.store.recoverOrphans().catch(() => undefined);
  }

  async load(deckId: string, account: Account): Promise<EditorSnapshotLoad> {
    await this.owned(deckId, account);
    return { schemaVersion: 1, snapshot: await this.store.load(account.id, deckId) };
  }

  async save(deckId: string, body: unknown, account: Account): Promise<EditorSnapshotSaveResponse> {
    await this.owned(deckId, account);
    const parsed = editorSnapshotSaveRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const prior = await this.store.savedOutcome?.(account.id, deckId, parsed.data.idempotencyKey);
    if (prior) return prior;
    const operation = `edit:${account.id}:${deckId}:${parsed.data.idempotencyKey}`;
    const usage = this.usage;
    const worker = usage
      ? await usage.translate(() => usage.store.admit(account.id, operation, 'edit'))
      : null;
    try {
      const save = () =>
        this.store.save(
          account.id,
          deckId,
          parsed.data,
          (client) => this.usage?.verifySnapshotStorage(account.id, client) ?? Promise.resolve(),
        );
      const result = this.usage
        ? await this.usage.write(
            account.id,
            await this.usage.snapshotReserve(
              account.id,
              deckId,
              parsed.data.idempotencyKey,
              parsed.data,
            ),
            save,
          )
        : await save();
      if (worker)
        await this.usage?.store.finish(account.id, operation, result.kind === 'saved', worker);
      return result;
    } catch (error) {
      if (worker) await this.usage?.store.finish(account.id, operation, false, worker);
      if (error instanceof EditorMediaMissingError) {
        throw new ConflictException('Нужные картинки ещё не записаны. Снимок не опубликован.');
      }
      if (error instanceof EditorRevisionError) {
        throw new ConflictException('Нет редакции, которую ожидал клиент.');
      }
      throw error;
    }
  }

  async putMedia(deckId: string, body: unknown, account: Account): Promise<EditorMediaRef> {
    await this.owned(deckId, account);
    const parsed = editorMediaPutRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const request = parsed.data;
    const decoded = decodeEditorMedia(request.mediaPart, request.dataUrl);
    try {
      const put = () =>
        this.store.putMedia(
          account.id,
          deckId,
          decoded.mediaPart,
          decoded.bytes,
          decoded.contentType,
        );
      return this.usage
        ? await this.usage.write(
            account.id,
            await this.usage.mediaReserve(account.id, deckId, decoded.bytes),
            put,
          )
        : await put();
    } catch (error) {
      if (error instanceof EditorMediaConflictError) {
        throw new ConflictException('Эта картинка уже сохранена с другими байтами.');
      }
      throw error;
    }
  }

  async readMedia(deckId: string, mediaPart: string, account: Account): Promise<Buffer> {
    await this.owned(deckId, account);
    if (!/^upload\/[\w.-]+\.(?:png|jpe?g)$/.test(mediaPart)) {
      throw new NotFoundException('Picture not found.');
    }
    const bytes = await this.store.readMedia(account.id, deckId, mediaPart);
    if (!bytes) throw new NotFoundException('Picture not found.');
    return bytes;
  }

  /**
   * Export one stored revision. Slides are read from that revision, not from the request body,
   * so edits made while the export runs cannot change the file.
   */
  async exportRevision(
    deckId: string,
    revision: number,
    body: unknown,
    account: Account,
  ): Promise<EditorRevisionExportResponse> {
    const owned = await this.owned(deckId, account);
    const parsed = editorRevisionExportRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.message);
    const request = parsed.data;
    const snapshot = await this.store.loadRevision(account.id, deckId, revision);
    if (!snapshot) throw new NotFoundException('Revision not found.');
    const slides = selectSlides(snapshot, request.slideIds);
    const variant = request.variant ?? owned.variant;
    const format = request.format;
    const formats: ('pptx' | 'pdf')[] = format === 'pdf' ? ['pptx', 'pdf'] : ['pptx'];
    const previews = format === 'png' || format === 'html';
    const exportId = randomUUID();
    const outputDir = join(owned.directory, 'exports', exportId);
    if (this.usage)
      return this.usage.write(
        account.id,
        0,
        () =>
          this.buildRevisionExport(
            deckId,
            snapshot,
            slides,
            variant,
            format,
            formats,
            previews,
            exportId,
            outputDir,
            owned.directory,
            account,
          ),
        () => rm(outputDir, { recursive: true, force: true }),
      );
    return this.buildRevisionExport(
      deckId,
      snapshot,
      slides,
      variant,
      format,
      formats,
      previews,
      exportId,
      outputDir,
      owned.directory,
      account,
    );
  }
  private async buildRevisionExport(
    deckId: string,
    snapshot: EditorSnapshot,
    slides: readonly SlideIr[],
    variant: LayoutVariantName,
    format: string,
    formats: ('pptx' | 'pdf')[],
    previews: boolean,
    exportId: string,
    outputDir: string,
    sourceDir: string,
    account: Account,
  ): Promise<EditorRevisionExportResponse> {
    await mkdir(outputDir, { recursive: true });
    try {
      const media = await this.mediaFor(account.id, deckId, slides, outputDir);
      await this.generation.engine.exportDeck({
        schemaVersion: 1,
        templatePath: join(sourceDir, 'deck.pptx'),
        variant,
        slides: slides as SlideIr[],
        outputDir,
        formats,
        previews,
        media,
      });
      await rename(join(outputDir, `${variant}.pptx`), join(outputDir, 'deck.pptx'));
      if (format === 'pdf') {
        await rename(join(outputDir, `${variant}.pdf`), join(outputDir, 'deck.pdf'));
      }
      const previewNames = previews
        ? (await readdir(join(outputDir, 'previews'))).filter((name) =>
            /^slide-\d+\.png$/.test(name),
          )
        : [];
      if (previews && previewNames.length === 0)
        throw new Error('Engine produced no export previews.');
      await writeFile(
        join(outputDir, 'manifest.json'),
        JSON.stringify({
          revision: snapshot.revision,
          contentSha256: snapshot.contentSha256,
          slideIds: slides.map((slide) => slide.slideId),
        }),
      );
      return {
        schemaVersion: 1,
        exportId,
        revision: snapshot.revision,
        contentSha256: snapshot.contentSha256,
        previews: previewNames,
      };
    } catch (error) {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Revision export failed.',
      );
    }
  }

  async exportFile(
    deckId: string,
    exportId: string,
    name: string,
    account: Account,
  ): Promise<{ path: string; type: string }> {
    await this.owned(deckId, account);
    if (!/^[0-9a-f-]{36}$/i.test(exportId) || !/^(deck\.(pptx|pdf)|slide-\d+\.png)$/.test(name)) {
      throw new NotFoundException('Artifact not found.');
    }
    const root = join(this.generation.directory(deckId), 'exports', exportId);
    const path = name.startsWith('slide-') ? join(root, 'previews', name) : join(root, name);
    try {
      await readFile(path);
    } catch {
      throw new NotFoundException('Artifact not found.');
    }
    const type = name.endsWith('.pptx')
      ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : name.endsWith('.pdf')
        ? 'application/pdf'
        : 'image/png';
    return { path, type };
  }

  private async owned(
    deckId: string,
    account: Account,
  ): Promise<{ directory: string; variant: LayoutVariantName }> {
    if (!(await this.generation.library.visible(deckId, account.id))) {
      throw new NotFoundException('Completed deck not found.');
    }
    const metadata = await this.generation.library.read(deckId);
    const variant = variantSchema.safeParse(metadata.variant);
    return {
      directory: this.generation.directory(deckId),
      variant: variant.success ? variant.data : 'balanced',
    };
  }

  private async mediaFor(
    accountId: string,
    deckId: string,
    slides: readonly SlideIr[],
    outputDir: string,
  ): Promise<{ mediaPart: string; path: string }[]> {
    const parts = [
      ...new Set(
        slides.flatMap((slide) =>
          slide.elements.flatMap((element) =>
            element.kind === 'image' && element.mediaPart.startsWith('upload/')
              ? [element.mediaPart]
              : [],
          ),
        ),
      ),
    ];
    const validated: ValidatedExportMedia[] = [];
    for (const mediaPart of parts) {
      const bytes = await this.store.readMedia(accountId, deckId, mediaPart);
      if (!bytes) throw new ConflictException('Нужные картинки ещё не записаны.');
      validated.push({
        mediaPart,
        bytes,
        extension: mediaPart.endsWith('.png') ? 'png' : 'jpg',
      });
    }
    return writeExportMedia(outputDir, validated);
  }
}

function selectSlides(
  snapshot: EditorSnapshot,
  slideIds: readonly string[] | undefined,
): SlideIr[] {
  if (!slideIds) return snapshot.slides as SlideIr[];
  const byId = new Map(snapshot.slides.map((slide) => [slide.slideId, slide]));
  const chosen: SlideIr[] = [];
  for (const id of slideIds) {
    const slide = byId.get(id);
    if (!slide)
      throw new BadRequestException(`Slide ${id} is not in revision ${snapshot.revision}.`);
    chosen.push(slide as SlideIr);
  }
  if (chosen.length === 0) throw new BadRequestException('Choose at least one slide.');
  return chosen;
}
