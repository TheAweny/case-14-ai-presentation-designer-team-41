import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { readFile } from 'node:fs/promises';
import {
  editorMediaPutResponseSchema,
  editorRevisionExportRequestSchema,
  editorRevisionExportResponseSchema,
  editorSnapshotLoadSchema,
  editorSnapshotSaveRequestSchema,
  editorSnapshotSaveResponseSchema,
} from '@lct/contracts';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { ApiAccountRoutes, ApiErrors, ApiFile, ApiJsonBody } from '../docs/decorators.js';
import { EditorService } from './editor.service.js';

const DECK = 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40';

@Controller('editor')
@ApiAccountRoutes('editor')
export class EditorController {
  constructor(@Inject(EditorService) private readonly editor: EditorService) {}

  @Get('decks/:deckId/snapshot')
  @ApiOperation({
    summary: 'Снимок колоды',
    description:
      'Последняя редакция, сохранённая этим аккаунтом. Чужой колоды нет. Снимка ещё нет — snapshot: null.',
  })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiOkResponse({ standardSchema: editorSnapshotLoadSchema })
  @ApiErrors(404)
  load(@Param('deckId') deckId: string, @CurrentAccount() account: Account) {
    return this.editor.load(deckId, account);
  }

  @Post('decks/:deckId/snapshot')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Сохранить редакцию',
    description:
      'Публикуется только когда все картинки уже записаны. expectedRevision — редакция, которую клиент видел. Та же редакция у двух клиентов не перезаписывается молча: в ответе конфликт, обе копии сохранены. Повтор с тем же idempotencyKey возвращает первый результат.',
  })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiJsonBody(editorSnapshotSaveRequestSchema)
  @ApiOkResponse({ standardSchema: editorSnapshotSaveResponseSchema })
  @ApiErrors(400, 404, 409)
  async save(
    @Param('deckId') deckId: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ) {
    const result = await this.editor.save(deckId, body, account);
    if (result.kind === 'conflict') throw new ConflictException(result);
    return result;
  }

  @Post('decks/:deckId/media')
  @ApiOperation({
    summary: 'Записать картинку снимка',
    description: 'Байты на диске, в базе только ссылка. Повтор тех же байт — та же ссылка.',
  })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiCreatedResponse({ standardSchema: editorMediaPutResponseSchema })
  @ApiErrors(400, 404, 409)
  async putMedia(
    @Param('deckId') deckId: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ) {
    const media = await this.editor.putMedia(deckId, body, account);
    return { schemaVersion: 1 as const, media };
  }

  @Get('decks/:deckId/media/:mediaPart')
  @ApiOperation({
    summary: 'Скачать картинку снимка',
    description: 'Один сегмент пути: upload%2F<id>.png. Чужой аккаунт получает 404.',
  })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiParam({ name: 'mediaPart', example: 'upload%2Fpicture.png' })
  @ApiFile('Картинка.', 'image/png', 'image/jpeg')
  @ApiErrors(404)
  async readMedia(
    @Param('deckId') deckId: string,
    @Param('mediaPart') mediaPart: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    const bytes = await this.editor.readMedia(deckId, decodeURIComponent(mediaPart), account);
    const type = mediaPart.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new StreamableFile(bytes, { type });
  }

  @Post('decks/:deckId/revisions/:revision/export')
  @ApiOperation({
    summary: 'Экспорт редакции',
    description:
      'Файл собирается из сохранённой редакции. Правки после этого запроса в него не попадают. Модель не вызывается.',
  })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiParam({ name: 'revision', example: 3 })
  @ApiJsonBody(editorRevisionExportRequestSchema)
  @ApiCreatedResponse({ standardSchema: editorRevisionExportResponseSchema })
  @ApiErrors(400, 404, 409, 503)
  exportRevision(
    @Param('deckId') deckId: string,
    @Param('revision') revision: string,
    @Body() body: unknown,
    @CurrentAccount() account: Account,
  ) {
    const parsed = Number(revision);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('Некорректный номер редакции.');
    }
    return this.editor.exportRevision(deckId, parsed, body, account);
  }

  @Get('decks/:deckId/exports/:exportId/:name')
  @ApiOperation({ summary: 'Скачать экспорт редакции' })
  @ApiParam({ name: 'deckId', example: DECK })
  @ApiParam({ name: 'exportId' })
  @ApiParam({ name: 'name', enum: ['deck.pptx', 'deck.pdf', 'slide-1.png'] })
  @ApiFile(
    'Файл экспорта.',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/pdf',
    'image/png',
  )
  @ApiErrors(404)
  async exportFile(
    @Param('deckId') deckId: string,
    @Param('exportId') exportId: string,
    @Param('name') name: string,
    @CurrentAccount() account: Account,
  ): Promise<StreamableFile> {
    const file = await this.editor.exportFile(deckId, exportId, name, account);
    return new StreamableFile(await readFile(file.path), {
      type: file.type,
      disposition: `attachment; filename="${name}"`,
    });
  }
}
